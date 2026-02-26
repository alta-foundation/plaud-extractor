import { ApiError, AuthError } from '../errors.js'
import { getLogger } from '../logger.js'
import type { StoredCredentials } from '../auth/types.js'
import {
  buildListUrl,
  buildBatchDetailUrl,
  buildAudioTempUrl,
  buildProfileUrl,
  extractRegionalBaseUrl,
  type EndpointMap,
} from './endpoints.js'
import { HttpClient } from './http.js'
import {
  PlaudRecordingSchema,
  PlaudTranscriptSchema,
  type PlaudRecording,
  type PlaudTranscript,
  type ListOptions,
  type PlaudClient,
} from './types.js'

export class PlaudApiClient implements PlaudClient {
  private readonly http: HttpClient
  private endpoints: EndpointMap

  constructor(creds: StoredCredentials) {
    this.http = new HttpClient(creds)
    this.endpoints = {
      ...creds.endpointMap,
      apiBaseUrl: creds.apiBaseUrl,
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const profileUrl = buildProfileUrl(this.endpoints)
      const raw = await this.http.get<unknown>(profileUrl)
      // A region-redirect response still means we're authenticated
      if (extractRegionalBaseUrl(raw) !== null) return true
      // Check for error status in response body
      const r = raw as Record<string, unknown>
      return r?.status === 0 || r?.data_user != null
    } catch (err) {
      if (err instanceof AuthError) return false
      if (err instanceof ApiError && (err.statusCode === 401 || err.statusCode === 403)) return false
      return false
    }
  }

  async *listRecordings(opts?: ListOptions): AsyncGenerator<PlaudRecording> {
    const log = getLogger()
    let skip = 0
    const limit = 50
    let count = 0

    while (true) {
      const url = buildListUrl(this.endpoints, skip, limit)
      const raw = await this.http.get<unknown>(url)
      const items = extractFileList(raw)

      if (items.length === 0) break

      for (const item of items) {
        const recording = normalizeRecording(item)
        const parsed = PlaudRecordingSchema.parse(recording)

        // Apply since filter (no server-side date filtering)
        if (opts?.since && new Date(parsed.recordedAt) < opts.since) continue

        yield parsed
        count++

        if (opts?.limit && count >= opts.limit) return
      }

      log.debug({ skip, fetched: items.length }, 'Fetched recording page')

      // Stop when we get fewer items than the limit (last page)
      if (items.length < limit) break
      skip += items.length
    }
  }

  async getTranscript(recordingId: string): Promise<PlaudTranscript> {
    // Transcript data lives inside the recording object (trans_result field).
    // Fetch it via POST /file/list with the single recording ID.
    const url = buildBatchDetailUrl(this.endpoints)
    const raw = await this.http.post<unknown>(url, [recordingId])
    const items = extractFileList(raw)

    if (items.length === 0) {
      throw new ApiError(`Recording ${recordingId} not found`, 404)
    }

    const recording = items[0] as Record<string, unknown>
    const normalized = normalizeTranscript(recording, recordingId)
    return PlaudTranscriptSchema.parse(normalized)
  }

  async getAudioDownloadUrl(recordingId: string): Promise<string | null> {
    try {
      const url = buildAudioTempUrl(this.endpoints, recordingId)
      const raw = await this.http.get<unknown>(url)
      return extractTempUrl(raw)
    } catch (err) {
      getLogger().debug({ recordingId, err }, 'Could not get audio download URL')
      return null
    }
  }

  getHttpClient(): HttpClient {
    return this.http
  }
}

// ─── Adaptation Layer ─────────────────────────────────────────────────────────
//
// Real Plaud API shapes (from arbuzmell/plaud-api reference client):
//
// GET /file/simple/web response:
//   { data_file_list: [{ id, filename, duration_ms, created_at, has_transcription,
//                         filesize, filetag_id_list, has_summary }] }
//
// POST /file/list response (full detail):
//   { data_file_list: [{ ...above... + trans_result: [...segments...], ai_content: {...} }] }
//
// trans_result segment shape:
//   { speaker: string, text: string, start_time_ms: number, end_time_ms: number }
//
// GET /file/temp-url/<id> response:
//   { temp_url: "https://s3.amazonaws.com/...?X-Amz-..." }

type AnyObject = Record<string, unknown>

function extractFileList(raw: unknown): unknown[] {
  const obj = raw as AnyObject
  // Primary response shape: { data_file_list: [...] }
  if (Array.isArray(obj?.data_file_list)) return obj.data_file_list as unknown[]
  // Fallback shapes
  if (Array.isArray(obj?.data)) return obj.data as unknown[]
  if (Array.isArray(obj?.list)) return obj.list as unknown[]
  if (Array.isArray(raw)) return raw as unknown[]
  return []
}

function normalizeRecording(raw: unknown): Omit<PlaudRecording, 'mimeType'> & { mimeType?: string } {
  const r = raw as AnyObject

  // duration is in milliseconds — convert to seconds
  const durationMs = Number(r['duration'] ?? r['duration_ms'] ?? 0)
  const duration = durationMs / 1000

  // start_time is Unix milliseconds (the actual recording start time)
  const startTimeMs = Number(r['start_time'] ?? 0)
  const recordedAt = startTimeMs > 0 ? new Date(startTimeMs).toISOString() : new Date().toISOString()

  // version_ms is when the record was last synced; edit_time is seconds
  const versionMs = Number(r['version_ms'] ?? 0)
  const editTimeSec = Number(r['edit_time'] ?? 0)
  const updatedAt = versionMs > 0 ? new Date(versionMs).toISOString() : recordedAt
  const createdAt = editTimeSec > 0 ? new Date(editTimeSec * 1000).toISOString() : recordedAt

  // Determine mime type from the fullname file extension
  const fullname = String(r['fullname'] ?? '')
  const ext = fullname.split('.').pop()?.toLowerCase()
  const mimeType =
    ext === 'ogg' ? 'audio/ogg' :
    ext === 'm4a' ? 'audio/m4a' :
    ext === 'mp3' ? 'audio/mpeg' :
    ext === 'opus' ? 'audio/ogg; codecs=opus' :
    'audio/mp4'

  return {
    id: String(r['id'] ?? ''),
    title: stringOrUndefined(r['filename'] ?? r['name'] ?? r['title']),
    duration,
    recordedAt,
    createdAt,
    updatedAt,
    fileSize: numberOrUndefined(r['filesize'] ?? r['file_size']),
    mimeType,
    hasTranscript: Boolean(r['is_trans'] ?? r['has_transcription'] ?? r['hasNote']),
    transcriptStatus: r['is_trans'] ? 'completed' : undefined,
    language: stringOrUndefined(r['language'] ?? r['lang']),
    deviceId: stringOrUndefined(r['serial_number'] ?? r['device_id'] ?? r['deviceId']),
    tags: arrayOfStrings(r['filetag_id_list'] ?? r['tags']),
    folderId: undefined,
    summary: extractSummaryText(r['ai_content']),
    _raw: r,
  }
}

function normalizeTranscript(raw: unknown, recordingId: string): PlaudTranscript {
  const r = raw as AnyObject
  const transResult = r['trans_result']
  const segmentsRaw = Array.isArray(transResult) ? transResult as AnyObject[] : []

  const segments = segmentsRaw.map((s, i) => ({
    index: i,
    startMs: Number(s['start_time_ms'] ?? s['startMs'] ?? s['startTime'] ?? 0),
    endMs: Number(s['end_time_ms'] ?? s['endMs'] ?? s['endTime'] ?? 0),
    speaker: stringOrUndefined(s['speaker']),
    text: String(s['text'] ?? '').trim(),
    confidence: undefined,
  }))

  const fullText = segments.map(s => s.text).filter(Boolean).join('\n\n')
  // duration field from POST /file/list is in milliseconds — convert to seconds
  const durationMs = Number(r['duration_ms'] ?? r['duration'] ?? 0)
  const duration = durationMs / 1000

  return {
    recordingId,
    language: stringOrUndefined(r['language'] ?? r['lang']),
    duration,
    segments,
    fullText,
    createdAt: stringOrUndefined(r['created_at'] ?? r['createTime']) ? toIso(r['created_at'] ?? r['createTime']) : undefined,
    _raw: r as Record<string, unknown>,
  }
}

function extractTempUrl(raw: unknown): string | null {
  const obj = raw as AnyObject
  return stringOrUndefined(obj?.['temp_url'] ?? obj?.['url'] ?? obj?.['downloadUrl']) ?? null
}

function extractSummaryText(aiContent: unknown): string | undefined {
  if (!aiContent || typeof aiContent !== 'object') return undefined
  const obj = aiContent as AnyObject
  // ai_content can have various summary fields
  const text = obj['summary'] ?? obj['text'] ?? obj['content']
  return stringOrUndefined(text)
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function toIso(val: unknown): string {
  if (typeof val === 'string' && val.length > 0) {
    // Already ISO string
    if (val.includes('T') || val.includes('-')) return new Date(val).toISOString()
    // Unix ms as string
    const n = Number(val)
    if (isFinite(n) && n > 0) {
      return new Date(n > 1e12 ? n : n * 1000).toISOString()
    }
  }
  if (typeof val === 'number' && val > 0) {
    return new Date(val > 1e12 ? val : val * 1000).toISOString()
  }
  return new Date().toISOString()
}

function stringOrUndefined(val: unknown): string | undefined {
  if (typeof val === 'string' && val.length > 0) return val
  return undefined
}

function numberOrUndefined(val: unknown): number | undefined {
  const n = Number(val)
  return isFinite(n) && n >= 0 ? n : undefined
}

function arrayOfStrings(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined
  const result = val.filter(v => typeof v === 'string') as string[]
  return result.length > 0 ? result : undefined
}
