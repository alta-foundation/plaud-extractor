import fs from 'node:fs/promises'
import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadCredentials, isExpired } from '../auth/token-store.js'
import { syncStatePath } from '../storage/paths.js'
import { SyncStateSchema } from '../sync/types.js'

export function registerReadTools(server: McpServer, outDir: string): void {

  // ── plaud_status ──────────────────────────────────────────────────────────

  server.tool(
    'plaud_status',
    'Check Plaud connection status, last sync time, and local recording count.',
    {},
    async () => {
      const creds = await loadCredentials().catch(() => null)

      let auth: string
      if (!creds) {
        auth = 'not authenticated — run: alta-plaud auth'
      } else if (isExpired(creds)) {
        auth = 'token expired — run: alta-plaud auth'
      } else {
        auth = 'authenticated'
      }

      let lastSync = 'never'
      let recordingCount = 0
      try {
        const raw = await fs.readFile(syncStatePath(outDir), 'utf8')
        const state = SyncStateSchema.parse(JSON.parse(raw))
        if (state.lastSuccessfulSyncAt) lastSync = state.lastSuccessfulSyncAt
        recordingCount = Object.keys(state.recordings).length
      } catch { /* no state file yet */ }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ auth, lastSync, recordingCount, outDir }, null, 2),
        }],
      }
    },
  )

  // ── plaud_list_recordings ─────────────────────────────────────────────────

  server.tool(
    'plaud_list_recordings',
    'List locally synced Plaud recordings. Filter by date or search title.',
    {
      limit: z.number().int().min(1).max(200).default(20).describe('Max results (default 20)'),
      since: z.string().optional().describe('ISO date — only recordings after this date'),
      search: z.string().optional().describe('Case-insensitive title filter'),
    },
    async ({ limit, since, search }) => {
      let recordings = await walkRecordingMeta(outDir)

      if (since) {
        const sinceDate = new Date(since)
        recordings = recordings.filter(r => new Date(r.recorded_at ?? '') >= sinceDate)
      }
      if (search) {
        const q = search.toLowerCase()
        recordings = recordings.filter(r => (r.title ?? '').toLowerCase().includes(q))
      }

      recordings.sort((a, b) => (b.recorded_at ?? '').localeCompare(a.recorded_at ?? ''))
      const page = recordings.slice(0, limit)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total: recordings.length,
            returned: page.length,
            recordings: page.map(r => ({
              id: r.source_recording_id,
              title: r.title,
              recorded_at: r.recorded_at,
              duration_seconds: r.duration_seconds,
              has_transcript: r.has_transcript,
            })),
          }, null, 2),
        }],
      }
    },
  )

  // ── plaud_get_transcript ──────────────────────────────────────────────────

  server.tool(
    'plaud_get_transcript',
    'Get the full transcript of a recording by ID or partial title match.',
    {
      recordingId: z.string().optional().describe('Exact recording ID'),
      title: z.string().optional().describe('Partial title match (case-insensitive)'),
    },
    async ({ recordingId, title }) => {
      if (!recordingId && !title) {
        return { content: [{ type: 'text' as const, text: 'Error: provide recordingId or title' }] }
      }

      const recordings = await walkRecordingMeta(outDir)
      let match: RecordingMeta | undefined

      if (recordingId) {
        match = recordings.find(r => r.source_recording_id === recordingId)
      } else if (title) {
        const q = title.toLowerCase()
        match = recordings.find(r => (r.title ?? '').toLowerCase().includes(q))
      }

      if (!match) {
        return {
          content: [{
            type: 'text' as const,
            text: `No recording found matching: ${recordingId ?? title}`,
          }],
        }
      }

      let transcript = ''
      try {
        transcript = await fs.readFile(path.join(match._dir, 'transcript.txt'), 'utf8')
      } catch {
        try {
          const raw = await fs.readFile(path.join(match._dir, 'transcript.json'), 'utf8')
          const data = JSON.parse(raw) as { segments?: Array<{ text?: string }> }
          transcript = (data.segments ?? []).map(s => s.text ?? '').filter(Boolean).join('\n\n')
        } catch {
          transcript = '(no transcript available)'
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: match.source_recording_id,
            title: match.title,
            recorded_at: match.recorded_at,
            duration_seconds: match.duration_seconds,
            transcript,
          }, null, 2),
        }],
      }
    },
  )
}

// ─── Filesystem helpers ────────────────────────────────────────────────────────

interface RecordingMeta {
  source_recording_id: string
  title?: string
  recorded_at?: string
  duration_seconds?: number
  has_transcript?: boolean
  _dir: string
}

async function walkRecordingMeta(outDir: string): Promise<RecordingMeta[]> {
  const recordingsBase = path.join(outDir, 'recordings')
  const results: RecordingMeta[] = []

  let yearDirs: string[]
  try {
    yearDirs = await fs.readdir(recordingsBase)
  } catch {
    return results
  }

  for (const year of yearDirs) {
    let monthDirs: string[]
    try { monthDirs = await fs.readdir(path.join(recordingsBase, year)) }
    catch { continue }

    for (const month of monthDirs) {
      let recDirs: string[]
      try { recDirs = await fs.readdir(path.join(recordingsBase, year, month)) }
      catch { continue }

      for (const recDir of recDirs) {
        const dirPath = path.join(recordingsBase, year, month, recDir)
        try {
          const raw = await fs.readFile(path.join(dirPath, 'meta.json'), 'utf8')
          const meta = JSON.parse(raw) as Record<string, unknown>
          results.push({
            source_recording_id: String(meta['source_recording_id'] ?? ''),
            title: meta['title'] as string | undefined,
            recorded_at: meta['recorded_at'] as string | undefined,
            duration_seconds: meta['duration_seconds'] as number | undefined,
            has_transcript: meta['has_transcript'] as boolean | undefined,
            _dir: dirPath,
          })
        } catch { continue }
      }
    }
  }

  return results
}
