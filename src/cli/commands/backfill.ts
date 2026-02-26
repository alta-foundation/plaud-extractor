import type { Command } from 'commander'
import { PlaudExtractor } from '../../PlaudExtractor.js'
import { defaultOutDir } from '../../storage/paths.js'
import type { TranscriptFormat } from '../../storage/recording-store.js'

export function registerBackfillCommand(program: Command): void {
  program
    .command('backfill')
    .description('Download all recordings from scratch (ignores incremental state)')
    .option('--out <dir>', 'Output directory', defaultOutDir())
    .option('--since <iso>', 'Only backfill recordings after this ISO date')
    .option('--limit <n>', 'Max number of recordings to process', parseInt)
    .option('--concurrency <n>', 'Parallel downloads (default: 3)', parseInt, 3)
    .option('--formats <list>', 'Transcript formats: json,txt,md (default: all)', 'json,txt,md')
    .option('--dataset', 'Append to datasets/plaud_transcripts.jsonl (default: on)', true)
    .option('--no-dataset', 'Skip dataset output')
    .option('--dry-run', 'Print plan without downloading', false)
    .option('--verbose', 'Verbose logging', false)
    .option('--yes', 'Skip confirmation prompt', false)
    .action(async (opts: {
      out: string
      since?: string
      limit?: number
      concurrency: number
      formats: string
      dataset: boolean
      dryRun: boolean
      verbose: boolean
      yes: boolean
    }) => {
      if (!opts.yes && !opts.dryRun) {
        const confirmed = await confirm(
          'Backfill will re-evaluate all recordings and may overwrite existing files. Continue? (y/N) '
        )
        if (!confirmed) {
          console.log('Aborted.')
          return
        }
      }

      const extractor = new PlaudExtractor({ outDir: opts.out, verbose: opts.verbose })
      const formats = parseFormats(opts.formats)

      const result = await extractor.backfill({
        since: opts.since ? new Date(opts.since) : undefined,
        limit: opts.limit,
        concurrency: opts.concurrency,
        formats,
        includeDataset: opts.dataset,
        dryRun: opts.dryRun,
      })

      const durationSec = (result.durationMs / 1000).toFixed(1)
      console.log(`\nBackfill complete (${durationSec}s)`)
      console.log(`  Downloaded:  ${result.succeeded}`)
      console.log(`  Skipped:     ${result.skipped}`)
      console.log(`  Failed:      ${result.failed}`)
      if (result.datasetPath) console.log(`  Dataset:     ${result.datasetPath}`)
    })
}

function parseFormats(str: string): TranscriptFormat[] {
  const valid: TranscriptFormat[] = ['json', 'txt', 'md']
  return str.split(',').filter((f): f is TranscriptFormat => valid.includes(f as TranscriptFormat))
}

async function confirm(message: string): Promise<boolean> {
  const { createInterface } = await import('node:readline')
  process.stdout.write(message)
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.once('line', (answer: string) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}
