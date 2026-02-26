# plaud-extractor — Claude Code guide

## What this project is
SDK + CLI to pull all recordings from a Plaud account into a local-first dataset.
Used as a building block for Alta | CORE (imported as `@alta-foundation/plaud-extractor`).

## Key architecture rules
- **SDK-first**: `PlaudExtractor` class in `src/PlaudExtractor.ts` is the public API. All core logic lives there and in sub-modules. The CLI (`src/cli/bin.ts`) is a thin wrapper — the **only** place `process.exit()` is called.
- **No side effects at import**: library code never writes to `process.stdout` or calls `process.exit()`.
- **Atomic writes**: all file writes go through `src/storage/atomic.ts:writeFileAtomic`.
- **Adaptation layer**: `src/client/plaud-client.ts` contains `normalizeRecording()` and `normalizeTranscript()`. These translate raw Plaud API shapes to the canonical schema. **Update these first** when real API response shapes are observed.

## Dev commands (pnpm)
```bash
pnpm dev -- auth                          # first-time auth (launches browser)
pnpm dev -- sync --dry-run               # preview what would be downloaded
pnpm dev -- sync --out ~/alta/data/plaud  # incremental sync
pnpm dev -- backfill --limit 5           # download first 5 recordings
pnpm dev -- verify --repair              # check + fix checksums
pnpm build                               # compile to dist/
pnpm typecheck                           # type-check without emitting
```

## File locations
| Purpose | Path |
|---|---|
| Auth credentials | `~/.alta/plaud-auth.json` |
| Data output (default) | `~/alta/data/plaud/` |
| Sync state | `<out>/_state/sync_state.json` |
| Run logs | `<out>/_state/run_logs.ndjson` |
| Dataset | `<out>/datasets/plaud_transcripts.jsonl` |

## Reading run logs
```bash
tail -f ~/alta/data/plaud/_state/run_logs.ndjson | jq .
jq 'select(.recordingId == "abc123")' ~/alta/data/plaud/_state/run_logs.ndjson
```

## How Alta CORE uses this SDK
```typescript
import { PlaudExtractor } from '@alta-foundation/plaud-extractor'

const extractor = new PlaudExtractor({ outDir: '~/alta/data/plaud' })
const result = await extractor.sync({ since: new Date('2026-01-01') })
console.log(result.succeeded, 'new recordings downloaded')
```

## After first real auth capture
1. Run `pnpm dev -- auth` and log in manually
2. Inspect `~/.alta/plaud-auth.json` → check `endpointMap`
3. Copy a real recording JSON response into `src/client/plaud-client.ts` normalizeRecording()
4. Copy a real transcript JSON response into normalizeTranscript()
5. Run `pnpm dev -- sync --dry-run --limit 1` to verify parsing
