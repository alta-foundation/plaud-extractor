import { z } from 'zod'
import type { TranscriptFormat } from '../storage/recording-store.js'

export const RecordingStateSchema = z.object({
  recordedAt: z.string().datetime(),
  contentHash: z.string().optional(),
  downloadedAt: z.string().datetime().optional(),
  hasAudio: z.boolean().default(false),
  hasTranscript: z.boolean().default(false),
  verified: z.boolean().default(false),
  verifiedAt: z.string().datetime().optional(),
})

export type RecordingState = z.infer<typeof RecordingStateSchema>

export const SyncStateSchema = z.object({
  schemaVersion: z.literal(1),
  lastSuccessfulSyncAt: z.string().datetime().optional(),
  lastAttemptAt: z.string().datetime().optional(),
  recordings: z.record(z.string(), RecordingStateSchema),
})

export type SyncState = z.infer<typeof SyncStateSchema>

export interface SyncOptions {
  /** Output directory root */
  outDir: string
  /** Only sync recordings after this date */
  since?: Date
  /** Max number of recordings to process */
  limit?: number
  /** Parallel downloads (default: 3) */
  concurrency: number
  /** Transcript formats to write */
  formats: TranscriptFormat[]
  /** Append to JSONL dataset */
  includeDataset: boolean
  /** Print plan without downloading */
  dryRun: boolean
}

export interface BackfillOptions extends Omit<SyncOptions, 'since'> {
  /** Backfill from a specific date; defaults to all-time */
  since?: Date
}

export interface SyncResult {
  mode: 'sync' | 'backfill'
  attempted: number
  succeeded: number
  failed: number
  skipped: number
  durationMs: number
  errors: Array<{ recordingId: string; error: Error }>
  datasetPath?: string
}

export interface VerifyResult {
  scanned: number
  ok: number
  failed: number
  repaired: number
  issues: Array<{ recordingId: string; file: string; issue: string }>
}
