// SDK public API — what Alta CORE and other consumers import
export { PlaudExtractor } from './PlaudExtractor.js'
export type { PlaudExtractorConfig } from './PlaudExtractor.js'

// Types
export type { SyncOptions, SyncResult, BackfillOptions, VerifyResult } from './sync/types.js'
export type { PlaudRecording, PlaudTranscript, TranscriptSegment, ListOptions } from './client/types.js'
export type { AuthSession, StoredCredentials } from './auth/types.js'

// Errors — consumers may need to catch these
export {
  PlaudError,
  AuthError,
  ApiError,
  StorageError,
  ChecksumMismatchError,
} from './errors.js'
