import type { Command } from 'commander'
import { PlaudExtractor } from '../../PlaudExtractor.js'
import { defaultOutDir } from '../../storage/paths.js'
import type { TranscriptFormat } from '../../storage/recording-store.js'

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Pull new or updated recordings from Plaud (incremental)')
    .option('--out <dir>', 'Output directory', defaultOutDir())
    .option('--since <iso>', 'Only sync recordings after this ISO date (overrides last-sync state)')
    .option('--limit <n>', 'Max number of recordings to process', parseInt)
    .option('--concurrency <n>', 'Parallel downloads (default: 3)', parseInt, 3)
    .option('--formats <list>', 'Transcript formats: json,txt,md (default: all)', 'json,txt,md')
    .option('--dataset', 'Append to datasets/plaud_transcripts.jsonl (default: on)', true)
    .option('--no-dataset', 'Skip dataset output')
    .option('--dry-run', 'Print plan without downloading', false)
    .option('--verbose', 'Verbose logging', false)
    .option('--redact', 'Redact tokens from logs', false)
    .action(async (opts: {
      out: string
      since?: string
      limit?: number
      concurrency: number
      formats: string
      dataset: boolean
      dryRun: boolean
      verbose: boolean
      redact: boolean
    }) => {
      const extractor = new PlaudExtractor({
        outDir: opts.out,
        verbose: opts.verbose,
        redact: opts.redact,
      })

      const formats = parseFormats(opts.formats)
      const result = await extractor.sync({
        since: opts.since ? new Date(opts.since) : undefined,
        limit: opts.limit,
        concurrency: opts.concurrency,
        formats,
        includeDataset: opts.dataset,
        dryRun: opts.dryRun,
      })

      printSyncSummary(result)
    })
}

function parseFormats(str: string): TranscriptFormat[] {
  const valid: TranscriptFormat[] = ['json', 'txt', 'md']
  return str.split(',').filter((f): f is TranscriptFormat => valid.includes(f as TranscriptFormat))
}

function printSyncSummary(result: import('../../sync/types.js').SyncResult): void {
  const durationSec = (result.durationMs / 1000).toFixed(1)
  console.log(`\nSync complete (${durationSec}s)`)
  console.log(`  Downloaded:  ${result.succeeded}`)
  console.log(`  Skipped:     ${result.skipped}`)
  console.log(`  Failed:      ${result.failed}`)
  if (result.datasetPath) {
    console.log(`  Dataset:     ${result.datasetPath}`)
  }
  if (result.errors.length > 0) {
    console.error(`\nFailed recordings:`)
    for (const { recordingId, error } of result.errors) {
      console.error(`  ${recordingId}: ${error.message}`)
    }
  }
}
