import fs from 'node:fs/promises'
import { authTokenPath } from '../storage/paths.js'
import { StoredCredentialsSchema, type AuthSession, type StoredCredentials } from './types.js'
import { writeFileAtomic } from '../storage/atomic.js'
import { getLogger } from '../logger.js'

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const tokenPath = authTokenPath()
  try {
    const raw = await fs.readFile(tokenPath, 'utf8')
    const json = JSON.parse(raw)
    const result = StoredCredentialsSchema.safeParse(json)
    if (!result.success) {
      getLogger().warn({ issues: result.error.issues }, 'Stored credentials failed schema validation — re-authenticate')
      return null
    }
    return result.data
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    getLogger().warn({ err }, 'Failed to read credentials file')
    return null
  }
}

export async function saveCredentials(session: AuthSession): Promise<void> {
  const tokenPath = authTokenPath()
  const stored: StoredCredentials = { ...session, schemaVersion: 1 }
  await writeFileAtomic(tokenPath, JSON.stringify(stored, null, 2))
  getLogger().info({ path: tokenPath }, 'Auth credentials saved')
}

/** Returns true if the stored credentials are expired. */
export function isExpired(creds: StoredCredentials): boolean {
  const now = Date.now()

  // Explicit expiresAt takes precedence
  if (creds.expiresAt) {
    return now > new Date(creds.expiresAt).getTime()
  }

  // If we have a JWT bearer token, decode the exp claim (most reliable)
  if (creds.authToken) {
    const jwtExp = decodeJwtExp(creds.authToken)
    if (jwtExp !== null) return now > jwtExp * 1000
  }

  // Fallback: check only plaud.ai session cookies (ignore analytics/CDN cookies
  // which have short TTLs and would cause false "expired" readings)
  const plaudCookies = creds.cookies.filter(
    c => c.expires && c.expires > 0 && (c.domain.endsWith('.plaud.ai') || c.domain === 'plaud.ai')
  )
  if (plaudCookies.length > 0) {
    const minExpiry = Math.min(...plaudCookies.map(c => (c.expires ?? 0) * 1000))
    if (minExpiry > 0 && now > minExpiry) return true
  }

  // Last resort: treat as expired after 30 days
  const capturedAt = new Date(creds.capturedAt).getTime()
  return now - capturedAt > 30 * 24 * 60 * 60 * 1000
}

/** Decode the `exp` claim from a JWT (no signature verification — just decode). */
function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    const exp = payload['exp']
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}

export function cookieHeader(creds: StoredCredentials): string {
  return creds.cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

export { authTokenPath }
