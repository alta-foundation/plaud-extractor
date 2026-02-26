import { execSync } from 'node:child_process'
import { chromium, type Page, type Request as PWRequest, type BrowserContext } from 'playwright'
import { AuthError } from '../errors.js'
import { getLogger } from '../logger.js'
import { loadCredentials } from './token-store.js'
import { extractRegionalBaseUrl } from '../client/endpoints.js'
import type { AuthSession, EndpointMap } from './types.js'

const PLAUD_APP_URL = 'https://web.plaud.ai'

export interface BrowserAuthOptions {
  headless?: boolean
  email?: string
  password?: string
  /** How long to wait for the user to log in (ms). Default: 5 minutes. */
  loginTimeoutMs?: number
}

export async function runBrowserAuth(opts: BrowserAuthOptions = {}): Promise<AuthSession> {
  const log = getLogger()
  const launchOpts = {
    channel: 'chrome' as const,
    headless: opts.headless ?? false,
    args: ['--disable-blink-features=AutomationControlled'],
  }

  const browser = await chromium.launch(launchOpts).catch(async err => {
    const msg = String(err)
    if (msg.includes("Executable doesn't exist") || msg.includes('not found')) {
      log.warn('System Chrome not found, falling back to Playwright Chromium (Google OAuth may be blocked)')
      return chromium.launch({ headless: opts.headless ?? false }).catch(err2 => {
        if (String(err2).includes("Executable doesn't exist")) {
          log.info('Installing Playwright Chromium (one-time setup)...')
          execSync('npx playwright install chromium', { stdio: 'inherit' })
          return chromium.launch({ headless: opts.headless ?? false })
        }
        throw err2
      })
    }
    throw err
  })

  const context = await browser.newContext({ userAgent: undefined })
  const page = await context.newPage()

  // Remove webdriver property that Google checks for automation detection
  await page.addInitScript(
    'Object.defineProperty(navigator, "webdriver", { get: () => undefined })',
  )

  // Inject existing plaud.ai cookies so we don't need a fresh login if session is still valid
  await injectExistingCookies(context)

  try {
    log.info('Opening Plaud...')

    // Set up Bearer token capture BEFORE navigation — the SPA fires API calls on load
    const loginTimeoutMs = opts.loginTimeoutMs ?? 5 * 60_000
    const bearerTokenCapture = captureBearerToken(page, loginTimeoutMs, log)

    await page.goto(PLAUD_APP_URL, { waitUntil: 'domcontentloaded' })
    // Give SPA time to initialize and run its auth check (may redirect to /login)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

    if (opts.email && opts.password) {
      await automatedLogin(page, opts.email, opts.password)
    } else if (isLoginUrl(page.url())) {
      // Not logged in — prompt user and wait
      console.log('\n──────────────────────────────────────────────────────────')
      console.log('  Log in to Plaud in the browser window.')
      console.log('  The browser will close automatically once connected.')
      console.log(`  (Waiting up to ${Math.round(loginTimeoutMs / 60_000)} minutes)`)
      console.log('──────────────────────────────────────────────────────────\n')
    } else {
      log.info('Already connected — capturing token...')
    }

    // Wait for Bearer token from any API request (fires on page load if session is active,
    // or after login if the user needed to authenticate)
    const authToken = await bearerTokenCapture
    log.info('Bearer token captured — closing browser')

    const cookies = await context.cookies()
    // Close browser without blocking — Chrome can take a long time to flush its profile
    void browser.close().catch(() => {})

    // Discover the correct regional API base URL (e.g. api-euc1.plaud.ai for EU users)
    const apiBaseUrl = await discoverApiRegion(authToken)
    log.info({ apiBaseUrl }, 'Regional API base URL discovered')

    return {
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
        expires: c.expires && c.expires > 0 ? c.expires : undefined,
      })),
      authToken,
      apiBaseUrl,
      capturedAt: new Date().toISOString(),
      endpointMap: buildEndpointMap(apiBaseUrl),
    }
  } catch (err) {
    await browser.close().catch(() => {})
    throw err
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inject plaud.ai cookies from the previous auth session so the browser picks up
 * an existing session without requiring the user to log in again.
 */
async function injectExistingCookies(context: BrowserContext): Promise<void> {
  const log = getLogger()
  const existing = await loadCredentials().catch(() => null)
  if (!existing?.cookies?.length) return

  const plaudCookies = existing.cookies.filter(
    c => c.domain === 'web.plaud.ai' || c.domain.endsWith('.plaud.ai') || c.domain === 'plaud.ai',
  )
  if (plaudCookies.length === 0) return

  try {
    await context.addCookies(
      plaudCookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: (c.sameSite ?? 'Lax') as 'Strict' | 'Lax' | 'None',
        expires: c.expires ?? -1,
      })),
    )
    log.debug({ count: plaudCookies.length }, 'Injected existing session cookies')
  } catch (err) {
    log.debug({ err }, 'Could not inject existing cookies — fresh login required')
  }
}

/**
 * Wait for the first API request that carries a Bearer token.
 * This fires automatically when:
 *   - The page loads with an existing authenticated session (cookies restored)
 *   - The user completes login via Google OAuth or email
 *
 * Resolves with the raw token string (without "bearer " prefix).
 */
function captureBearerToken(page: Page, timeoutMs: number, log: ReturnType<typeof getLogger>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off('request', handler)
      reject(new AuthError(`Login timeout after ${Math.round(timeoutMs / 60_000)} minutes — no token captured`))
    }, timeoutMs)

    const handler = (req: PWRequest) => {
      const auth = req.headers()['authorization'] ?? req.headers()['Authorization']
      if (!auth) return
      const token = auth.replace(/^bearer\s+/i, '').trim()
      // Basic sanity check: JWT has 3 parts separated by dots
      if (token.split('.').length === 3) {
        clearTimeout(timer)
        page.off('request', handler)
        log.debug({ url: req.url() }, 'Bearer token found in request')
        resolve(token)
      }
    }

    page.on('request', handler)
  })
}

/** Discover the correct regional API base URL (e.g. https://api-euc1.plaud.ai). */
async function discoverApiRegion(token: string): Promise<string> {
  const log = getLogger()
  try {
    // The global endpoint returns a region-redirect response pointing to the right server
    const res = await fetch('https://api.plaud.ai/user/me', {
      headers: {
        'Authorization': `bearer ${token}`,
        'app-platform': 'web',
        'Origin': 'https://web.plaud.ai',
      },
    })
    const body = await res.json()
    const regional = extractRegionalBaseUrl(body)
    if (regional) return regional

    // If the global endpoint returns user data directly (no redirect), it IS the right base
    if ((body as Record<string, unknown>)?.data_user) return 'https://api.plaud.ai'
  } catch (err) {
    log.debug({ err }, 'Region discovery failed — using global API')
  }
  return 'https://api.plaud.ai'
}

/** Build the complete endpoint map from the known regional API base URL. */
function buildEndpointMap(apiBaseUrl: string): EndpointMap {
  return {
    listRecordings: `${apiBaseUrl}/file/simple/web`,
    batchDetail: `${apiBaseUrl}/file/list`,
    getAudioUrl: `${apiBaseUrl}/file/temp-url`,
    userProfile: `${apiBaseUrl}/user/me`,
    apiBaseUrl,
  }
}

function isLoginUrl(url: string): boolean {
  try {
    const p = new URL(url).pathname
    return p.startsWith('/login') || p.startsWith('/signin') || p.startsWith('/auth')
  } catch {
    return false
  }
}

async function automatedLogin(page: Page, email: string, password: string): Promise<void> {
  const log = getLogger()
  log.info('Attempting automated login...')

  const emailSelectors = [
    'input[type="email"]', 'input[name="email"]',
    'input[name="username"]', '[data-testid="email"]', '#email',
  ]
  const passwordSelectors = [
    'input[type="password"]', 'input[name="password"]',
    '[data-testid="password"]', '#password',
  ]

  for (const sel of emailSelectors) {
    if (await page.locator(sel).count() > 0) { await page.fill(sel, email); break }
  }
  for (const sel of passwordSelectors) {
    if (await page.locator(sel).count() > 0) { await page.fill(sel, password); break }
  }

  await page.click(
    'button[type="submit"], [type="submit"], button:has-text("Login"), button:has-text("Sign in")',
  )
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}
