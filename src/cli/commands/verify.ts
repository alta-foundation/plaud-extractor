import type { Command } from 'commander'
import { PlaudExtractor } from '../../PlaudExtractor.js'
import { defaultOutDir } from '../../storage/paths.js'

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Verify checksums for all downloaded recordings')
    .option('--out <dir>', 'Output directory', defaultOutDir())
    .option('--repair', 'Re-download files with checksum mismatches', false)
    .option('--verbose', 'Verbose logging', false)
    .action(async (opts: { out: string; repair: boolean; verbose: boolean }) => {
      const extractor = new PlaudExtractor({ outDir: opts.out, verbose: opts.verbose })

      console.log(`Verifying recordings in ${opts.out}...`)
      const result = await extractor.verify({ repair: opts.repair })

      console.log(`\nVerify complete`)
      console.log(`  Scanned:  ${result.scanned}`)
      console.log(`  OK:       ${result.ok}`)
      console.log(`  Failed:   ${result.failed}`)
      if (opts.repair) console.log(`  Repaired: ${result.repaired}`)

      if (result.issues.length > 0) {
        console.error(`\nIssues found:`)
        for (const issue of result.issues) {
          console.error(`  ${issue.recordingId}/${issue.file}: ${issue.issue}`)
        }
      }
    })
}
