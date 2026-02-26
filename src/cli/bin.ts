#!/usr/bin/env node
import { Command } from 'commander'
import { registerAuthCommand } from './commands/auth.js'
import { registerSyncCommand } from './commands/sync.js'
import { registerBackfillCommand } from './commands/backfill.js'
import { registerVerifyCommand } from './commands/verify.js'
import { ExitCode, toExitCode } from './exit-codes.js'

const program = new Command()
  .name('alta-plaud')
  .description('Export recordings, transcripts, and metadata from Plaud')
  .version('1.0.0')
  .helpOption('-h, --help', 'Show help')

registerAuthCommand(program)
registerSyncCommand(program)
registerBackfillCommand(program)
registerVerifyCommand(program)

program.parseAsync(process.argv).catch((err: unknown) => {
  // This is the only place in the codebase where process.exit() is called.
  const code = toExitCode(err)
  if (err instanceof Error) {
    console.error(`\nError: ${err.message}`)
    if (process.env['DEBUG']) console.error(err.stack)
  } else {
    console.error(`\nUnexpected error: ${String(err)}`)
  }
  process.exit(code)
})
