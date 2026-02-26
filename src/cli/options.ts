// Shared option definitions (reused across commands if needed in future)
export const COMMON_OPTIONS = {
  out: { flags: '--out <dir>', description: 'Output directory' },
  verbose: { flags: '--verbose', description: 'Verbose logging' },
  redact: { flags: '--redact', description: 'Redact auth tokens from logs' },
  dryRun: { flags: '--dry-run', description: 'Print plan without downloading' },
  concurrency: { flags: '--concurrency <n>', description: 'Parallel downloads (default: 3)' },
  formats: { flags: '--formats <list>', description: 'Transcript formats: json,txt,md' },
  limit: { flags: '--limit <n>', description: 'Max number of recordings to process' },
}
