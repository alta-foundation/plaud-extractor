import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createLogger, setLogger, type Logger } from './logger.js'
import { loadCredentials, saveCredentials, isExpired } from './auth/token-store.js'
import { runBrowserAuth, type BrowserAuthOptions } from './auth/browser-auth.js'
import { PlaudApiClient } from './client/plaud-client.js'
import { SyncEngine } from './sync/sync-engine.js'
import { IncrementalTracker } from './sync/incremental.js'
import { RecordingStore } from './storage/recording-store.js'
import { verifyChecksums } from './storage/checksums.js'
import { recordingDir, defaultOutDir } from './storage/paths.js'
import { AuthError } from './errors.js'
import type { SyncOptions, SyncResult, BackfillOptions, VerifyResult } from './sync/types.js'

export interface PlaudExtractorConfig {
  /** Output directory for recordings. Default: ~/alta/data/plaud */
  outDir?: string
  /** Inject a custom pino logger (e.g., from Alta CORE) */
  logger?: Logger
  /** Verbose logging */
  verbose?: boolean
  /** Redact tokens from logs */
  redact?: boolean
}

export class PlaudExtractor {
  private readonly outDir: string
  private readonly engine: SyncEngine

  constructor(config: PlaudExtractorConfig = {}) {
    this.outDir = config.outDir
      ? path.resolve(config.outDir.replace(/^~/, os.homedir()))
      : defaultOutDir()

    if (config.logger) {
      setLogger(config.logger)
    } else {
      createLogger(this.outDir, { verbose: config.verbose, redact: config.redact })
    }

    this.engine = new SyncEngine()
  }

  /**
   * Launch browser for authentication.
   * Saves credentials to ~/.alta/plaud-auth.json.
   */
  async authenticate(opts: BrowserAuthOptions = {}): Promise<void> {
    const session = await runBrowserAuth(opts)
    await saveCredentials(session)
  }

  /**
   * Check if credentials exist and are not expired.
   */
  async isAuthenticated(): Promise<boolean> {
    const creds = await loadCredentials()
    if (!creds) return false
    if (isExpired(creds)) return false
    return true
  }

  /**
   * Incremental sync: only download new or changed recordings since last run.
   * If the token expires mid-sync, re-authenticates automatically and retries once.
   */
  async sync(opts: Partial<SyncOptions> = {}): Promise<SyncResult> {
    return this.runWithReauth(opts, 'sync')
  }

  /**
   * Full backfill: re-evaluate all recordings regardless of sync state.
   * If the token expires mid-backfill, re-authenticates automatically and retries once.
   */
  async backfill(opts: Partial<BackfillOptions> = {}): Promise<SyncResult> {
    return this.runWithReauth(opts, 'backfill')
  }

  /**
   * Run sync/backfill, and if a token-expired AuthError occurs mid-run,
   * automatically re-authenticate and retry once.
   */
  private async runWithReauth(
    opts: Partial<SyncOptions>,
    mode: 'sync' | 'backfill',
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient()
      return await this.engine.run(client, this.buildSyncOptions(opts), mode)
    } catch (err) {
      if (!(err instanceof AuthError)) throw err

      // Token expired or rejected mid-run — re-authenticate and try once more
      console.error('\nSession expired during sync. Re-authenticating...')
      await this.authenticate()
      console.log('Re-authenticated. Resuming sync...\n')

      const client = await this.buildClient()
      return this.engine.run(client, this.buildSyncOptions(opts), mode)
    }
  }

  /**
   * Walk all recording folders and verify checksums.
   * With repair=true, re-download any file with a mismatch.
   */
  async verify(opts: { repair?: boolean } = {}): Promise<VerifyResult> {
    const client = opts.repair ? await this.buildClient() : null
    const tracker = new IncrementalTracker()
    await tracker.load(this.outDir)

    const result: VerifyResult = { scanned: 0, ok: 0, failed: 0, repaired: 0, issues: [] }
    const recordingIds = tracker.getAllRecordingIds()

    for (const id of recordingIds) {
      const state = tracker.getRecordingState(id)
      if (!state) continue

      const dir = recordingDir(this.outDir, state.recordedAt, id)
      result.scanned++

      try {
        const mismatches = await verifyChecksums(dir)
        if (mismatches.length === 0) {
          result.ok++
          tracker.markVerified(id)
        } else {
          result.failed++
          for (const m of mismatches) {
            result.issues.push({
              recordingId: id,
              file: path.basename(m.filePath),
              issue: `checksum mismatch (expected: ${m.expected.slice(0, 8)}..., got: ${m.actual === 'MISSING' ? 'MISSING' : m.actual.slice(0, 8) + '...'})`,
            })
          }

          // TODO: repair support requires re-fetching the recording object
          // For now, log the mismatch
        }
      } catch (err) {
        result.failed++
        result.issues.push({ recordingId: id, file: '', issue: String(err) })
      }
    }

    await tracker.persist(this.outDir)
    return result
  }

  /**
   * Export all local recordings to a JSONL dataset file.
   * Returns the path to the generated file.
   */
  async exportDataset(opts: { format?: 'jsonl' } = {}): Promise<string> {
    const { DatasetWriter } = await import('./storage/dataset-writer.js')
    const { default: fsSync } = await import('node:fs')

    // Walk recordings dir and collect existing transcript data
    const datasetWriter = new DatasetWriter(this.outDir)
    await datasetWriter.open()

    // Re-generate from existing transcript.json files on disk
    const recordingsBase = path.join(this.outDir, 'recordings')
    try {
      await this.walkAndExport(recordingsBase, datasetWriter)
    } finally {
      await datasetWriter.close()
    }

    return datasetWriter.path
  }

  private async walkAndExport(
    recordingsBase: string,
    dataset: InstanceType<typeof import('./storage/dataset-writer.js').DatasetWriter>,
  ): Promise<void> {
    const { PlaudRecordingSchema } = await import('./client/types.js')
    const { PlaudTranscriptSchema } = await import('./client/types.js')

    // Walk year/month/dir structure
    let yearDirs: string[]
    try {
      yearDirs = await fs.readdir(recordingsBase)
    } catch {
      return
    }

    for (const year of yearDirs) {
      const yearPath = path.join(recordingsBase, year)
      let monthDirs: string[]
      try {
        monthDirs = await fs.readdir(yearPath)
      } catch {
        continue
      }

      for (const month of monthDirs) {
        const monthPath = path.join(yearPath, month)
        let recDirs: string[]
        try {
          recDirs = await fs.readdir(monthPath)
        } catch {
          continue
        }

        for (const recDir of recDirs) {
          const recPath = path.join(monthPath, recDir)
          try {
            const metaRaw = await fs.readFile(path.join(recPath, 'meta.json'), 'utf8')
            const transcriptRaw = await fs.readFile(path.join(recPath, 'transcript.json'), 'utf8')
            const meta = JSON.parse(metaRaw) as Record<string, unknown>
            const transcriptData = JSON.parse(transcriptRaw) as Record<string, unknown>

            // Reconstruct minimal PlaudRecording from meta.json
            const recording = PlaudRecordingSchema.parse({
              id: meta['source_recording_id'],
              title: meta['title'],
              duration: meta['duration_seconds'],
              recordedAt: meta['recorded_at'],
              createdAt: meta['recorded_at'],
              updatedAt: meta['recorded_at'],
              hasTranscript: true,
              _raw: meta,
            })

            const fullText = ((transcriptData['segments'] ?? []) as Array<{ text?: string }>)
              .map(s => s.text ?? '')
              .filter(Boolean)
              .join('\n\n')

            const transcript = PlaudTranscriptSchema.parse({
              recordingId: String(meta['source_recording_id'] ?? ''),
              duration: Number(meta['duration_seconds'] ?? 0),
              segments: transcriptData['segments'] ?? [],
              fullText,
              _raw: transcriptData,
            })

            await dataset.append(this.outDir, recording, transcript)
          } catch {
            // Skip recordings with missing/invalid files
          }
        }
      }
    }
  }

  private async buildClient(): Promise<PlaudApiClient> {
    const creds = await loadCredentials()
    if (!creds) {
      throw new AuthError("No credentials found — run 'alta-plaud auth' to authenticate")
    }
    if (isExpired(creds)) {
      throw new AuthError("Credentials expired — run 'alta-plaud auth' to re-authenticate")
    }
    return new PlaudApiClient(creds)
  }

  private buildSyncOptions(partial: Partial<SyncOptions>): SyncOptions {
    return {
      outDir: this.outDir,
      since: partial.since,
      limit: partial.limit,
      concurrency: partial.concurrency ?? 3,
      formats: partial.formats ?? ['json', 'txt', 'md'],
      includeDataset: partial.includeDataset ?? true,
      dryRun: partial.dryRun ?? false,
    }
  }

  get dataDir(): string {
    return this.outDir
  }
}
