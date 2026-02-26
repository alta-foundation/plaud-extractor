import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { syncStatePath } from '../storage/paths.js'
import { writeFileAtomic } from '../storage/atomic.js'
import { SyncStateSchema, type SyncState, type RecordingState } from './types.js'
import type { PlaudRecording } from '../client/types.js'
import { getLogger } from '../logger.js'

export class IncrementalTracker {
  private state: SyncState = {
    schemaVersion: 1,
    recordings: {},
  }

  async load(outDir: string): Promise<void> {
    const filePath = syncStatePath(outDir)
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const json = JSON.parse(raw)
      const result = SyncStateSchema.safeParse(json)
      if (result.success) {
        this.state = result.data
        getLogger().debug(
          { recordingCount: Object.keys(this.state.recordings).length },
          'Loaded sync state',
        )
      } else {
        getLogger().warn({ issues: result.error.issues }, 'Sync state schema invalid — starting fresh')
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        getLogger().warn({ err }, 'Failed to read sync state — starting fresh')
      }
    }
  }

  async persist(outDir: string): Promise<void> {
    this.state.lastAttemptAt = new Date().toISOString()
    await writeFileAtomic(syncStatePath(outDir), JSON.stringify(this.state, null, 2))
  }

  markSuccessfulSync(): void {
    this.state.lastSuccessfulSyncAt = new Date().toISOString()
  }

  getSince(): Date | undefined {
    if (!this.state.lastSuccessfulSyncAt) return undefined
    return new Date(this.state.lastSuccessfulSyncAt)
  }

  needsDownload(recording: PlaudRecording): boolean {
    const existing = this.state.recordings[recording.id]
    if (!existing) return true

    const newHash = this.computeContentHash(recording)
    if (existing.contentHash !== newHash) return true

    // Re-download if key files are missing
    if (!existing.hasTranscript && recording.hasTranscript) return true
    if (!existing.downloadedAt) return true

    return false
  }

  computeContentHash(recording: PlaudRecording): string {
    const key = JSON.stringify({
      id: recording.id,
      updatedAt: recording.updatedAt,
      hasTranscript: recording.hasTranscript,
      transcriptStatus: recording.transcriptStatus,
      duration: recording.duration,
      title: recording.title,
    })
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
  }

  markComplete(
    recordingId: string,
    recordedAt: string,
    opts: { hasAudio: boolean; hasTranscript: boolean; contentHash: string },
  ): void {
    this.state.recordings[recordingId] = {
      recordedAt,
      contentHash: opts.contentHash,
      downloadedAt: new Date().toISOString(),
      hasAudio: opts.hasAudio,
      hasTranscript: opts.hasTranscript,
      verified: false,
    }
  }

  markVerified(recordingId: string): void {
    const existing = this.state.recordings[recordingId]
    if (existing) {
      existing.verified = true
      existing.verifiedAt = new Date().toISOString()
    }
  }

  getRecordingState(recordingId: string): RecordingState | undefined {
    return this.state.recordings[recordingId]
  }

  getAllRecordingIds(): string[] {
    return Object.keys(this.state.recordings)
  }

  get lastSuccessfulSyncAt(): string | undefined {
    return this.state.lastSuccessfulSyncAt
  }
}
