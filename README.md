# @alta-foundation/plaud-extractor

SDK + CLI to pull all recordings, transcripts, and metadata from a [Plaud](https://www.plaud.ai) account into a structured local-first dataset. Designed as a building block for Alta | CORE.

---

## Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Authentication](#authentication)
- [CLI](#cli)
- [SDK](#sdk)
- [MCP Server](#mcp-server)
- [Output Structure](#output-structure)
- [Environment Variables](#environment-variables)

---

## Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)
- Google Chrome installed on the machine (used for auth — bypasses Google's automation detection)

---

## Installation

```bash
# As a CLI tool
pnpm add -g @alta-foundation/plaud-extractor

# As an SDK dependency
pnpm add @alta-foundation/plaud-extractor
```

---

## Authentication

Authentication is required once. It opens a real Chrome browser, you log in to Plaud, and the session is saved to `~/.alta/plaud-auth.json`.

```bash
alta-plaud auth
```

The browser closes automatically once logged in. Credentials include a JWT valid for ~1 year — you won't need to repeat this often.

---

## CLI

### `alta-plaud sync`

Incremental sync — only downloads new or changed recordings since the last run.

```bash
alta-plaud sync [options]

Options:
  --out <dir>          Output directory (default: ~/alta/data/plaud)
  --since <iso>        Only sync recordings after this ISO date
  --limit <n>          Max number of recordings to process
  --concurrency <n>    Parallel downloads (default: 3)
  --formats <list>     Transcript formats: json,txt,md (default: all)
  --no-dataset         Skip appending to datasets/plaud_transcripts.jsonl
  --dry-run            Print what would be downloaded without doing it
  --verbose            Verbose logging
  --redact             Redact tokens from logs
```

```bash
# Preview what would sync
alta-plaud sync --dry-run

# Sync last 7 days only
alta-plaud sync --since $(date -v-7d +%Y-%m-%d)

# Sync to a custom directory
alta-plaud sync --out ~/my-recordings
```

If the session token expires mid-sync, re-authentication is triggered automatically.

---

### `alta-plaud backfill`

Full re-evaluation of all recordings, regardless of incremental state. Useful after a schema change or to repair gaps.

```bash
alta-plaud backfill [options]

Options:
  --out <dir>          Output directory (default: ~/alta/data/plaud)
  --since <iso>        Only backfill recordings after this ISO date
  --limit <n>          Max number of recordings to process
  --concurrency <n>    Parallel downloads (default: 3)
  --formats <list>     Transcript formats: json,txt,md (default: all)
  --no-dataset         Skip dataset output
  --dry-run            Print plan without downloading
  --yes                Skip confirmation prompt
  --verbose            Verbose logging
```

```bash
# Backfill first 10 recordings (useful for testing)
alta-plaud backfill --limit 10 --yes
```

---

### `alta-plaud verify`

Walk all downloaded recordings and verify checksums. Detects missing or corrupted files.

```bash
alta-plaud verify [options]

Options:
  --out <dir>    Output directory (default: ~/alta/data/plaud)
  --repair       Re-download files with checksum mismatches
  --verbose      Verbose logging
```

---

### `alta-plaud auth`

Launch browser for (re-)authentication.

```bash
alta-plaud auth [options]

Options:
  --out <dir>      Data directory for logs
```

---

## SDK

```typescript
import { PlaudExtractor } from '@alta-foundation/plaud-extractor'

const extractor = new PlaudExtractor({
  outDir: '~/alta/data/plaud',  // default
  verbose: false,
  redact: false,
})

// One-time auth (opens browser)
await extractor.authenticate()

// Incremental sync
const result = await extractor.sync({ since: new Date('2026-01-01') })
console.log(`${result.succeeded} downloaded, ${result.failed} failed`)

// Full backfill
await extractor.backfill({ limit: 50 })

// Verify checksums
const verify = await extractor.verify({ repair: false })

// Export JSONL dataset
const datasetPath = await extractor.exportDataset()
```

**Types available:**

```typescript
import type {
  SyncOptions,
  SyncResult,
  BackfillOptions,
  VerifyResult,
  PlaudRecording,
  PlaudTranscript,
  AuthSession,
} from '@alta-foundation/plaud-extractor'
```

**Error handling:**

```typescript
import { AuthError, ApiError, StorageError } from '@alta-foundation/plaud-extractor'

try {
  await extractor.sync()
} catch (err) {
  if (err instanceof AuthError) {
    // Token expired or invalid — re-authenticate
  }
}
```

---

## MCP Server

The MCP server exposes Plaud data as tools for Claude (or any MCP client). Read operations (list, transcript) are synchronous and work offline from local files. Sync/backfill run in the background and return a job ID for polling.

### Tools

| Tool | Type | Description |
|---|---|---|
| `plaud_status` | sync | Auth status, last sync time, recording count |
| `plaud_list_recordings` | sync | List local recordings — filter by date or title |
| `plaud_get_transcript` | sync | Full transcript by recording ID or partial title |
| `plaud_sync` | async | Start incremental sync → returns `jobId` |
| `plaud_backfill` | async | Start full backfill → returns `jobId` |
| `plaud_job_status` | sync | Poll status of a background job |

### Configuration

Add to Claude Code settings (`~/.claude/settings.json`) or your MCP client config:

```json
{
  "mcpServers": {
    "alta-plaud": {
      "command": "alta-plaud-mcp",
      "env": {
        "ALTA_DATA_DIR": "/Users/you/alta/data/plaud"
      }
    }
  }
}
```

If running from source:

```json
{
  "mcpServers": {
    "alta-plaud": {
      "command": "node",
      "args": ["/path/to/plaud-extractor/dist/mcp/server.js"],
      "env": {
        "ALTA_DATA_DIR": "/Users/you/alta/data/plaud"
      }
    }
  }
}
```

### Async job flow

```
Claude: plaud_sync({ since: "2026-02-01" })
→ { jobId: "sync_20260226_a1b2c3", status: "running" }

Claude: plaud_job_status({ jobId: "sync_20260226_a1b2c3" })
→ { status: "completed", result: { succeeded: 12, failed: 0, ... } }
```

---

## Output Structure

```
~/alta/data/plaud/
├── recordings/
│   └── 2026/
│       └── 02/
│           └── 20260224T083012Z__plaud_<id>/
│               ├── meta.json          # Recording metadata
│               ├── transcript.json    # Structured transcript with segments
│               ├── transcript.txt     # Plain text transcript
│               ├── transcript.md      # Markdown with YAML frontmatter + timestamps
│               ├── audio.ogg          # Original audio file
│               └── checksums.json     # SHA-256 hashes for all files
├── datasets/
│   └── plaud_transcripts.jsonl        # All recordings as JSONL (append-only)
└── _state/
    ├── sync_state.json                # Incremental sync state
    ├── run_logs.ndjson                # Structured logs (pino NDJSON)
    └── jobs/
        └── sync_<id>.json             # Background job state (MCP async)
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `ALTA_DATA_DIR` | Override default output directory (`~/alta/data/plaud`) |
| `LOG_LEVEL` | Pino log level: `debug`, `info`, `warn`, `error` (default: `info`) |
| `DEBUG` | Print full stack traces on CLI errors |

---

## Development

```bash
# Install dependencies
pnpm install

# First-time auth
pnpm dev -- auth

# Preview sync
pnpm dev -- sync --dry-run

# Sync with verbose logging
pnpm dev -- sync --verbose

# Run MCP server locally
pnpm dev:mcp

# Build to dist/
pnpm build

# Type-check without emitting
pnpm typecheck
```

### Releasing

Releases are fully automated via [semantic-release](https://semantic-release.gitbook.io). Push to `main` and CI handles versioning, tagging, CHANGELOG, and npm publish — no manual steps.

Version bumps are determined by commit message prefixes ([Conventional Commits](https://www.conventionalcommits.org)):

| Prefix | Example | Version bump |
|---|---|---|
| `fix:` | `fix: handle missing transcript gracefully` | patch `1.0.x` |
| `feat:` | `feat: add search filter to MCP list tool` | minor `1.x.0` |
| `feat!:` or `BREAKING CHANGE:` in footer | `feat!: rename outDir to dataDir` | major `x.0.0` |
| `chore:`, `docs:`, `ci:`, `refactor:` | `docs: update MCP setup instructions` | no release |

```bash
# These trigger a release when pushed to main:
git commit -m "fix: prevent duplicate downloads on retry"
git commit -m "feat: add plaud_search MCP tool"

# These do not trigger a release:
git commit -m "chore: update dependencies"
git commit -m "docs: improve README"
```
