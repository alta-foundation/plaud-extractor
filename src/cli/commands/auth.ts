import type { Command } from 'commander'
import { PlaudExtractor } from '../../PlaudExtractor.js'
import { AuthError } from '../../errors.js'
import { authTokenPath } from '../../auth/token-store.js'

export function registerAuthCommand(program: Command): void {
  program
    .command('auth')
    .description('Authenticate with Plaud by launching a browser (required before first sync)')
    .option('--headless', 'Run browser in headless mode (requires PLAUD_EMAIL + PLAUD_PASSWORD env vars)', false)
    .option('--out <dir>', 'Data directory for logs', undefined)
    .action(async (opts: { headless: boolean; out?: string }) => {
      const extractor = new PlaudExtractor({ outDir: opts.out })

      console.log('Launching browser to authenticate with Plaud...')

      await extractor.authenticate({
        headless: opts.headless,
        email: process.env['PLAUD_EMAIL'],
        password: process.env['PLAUD_PASSWORD'],
      })

      console.log(`\nAuthentication successful!`)
      console.log(`Credentials saved to: ${authTokenPath()}`)
      console.log(`\nYou can now run: alta-plaud sync`)
    })
}
