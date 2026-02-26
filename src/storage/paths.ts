import path from 'node:path'
import os from 'node:os'

export function defaultOutDir(): string {
  const env = process.env['ALTA_DATA_DIR']
  if (env) return path.resolve(env)
  return path.join(os.homedir(), 'alta', 'data', 'plaud')
}

/** plaud/recordings/2026/02/2026-02-24T083012Z__plaud_<id>/ */
export function recordingDir(outDir: string, recordedAt: string, recordingId: string): string {
  const dt = new Date(recordedAt)
  const year = String(dt.getUTCFullYear())
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const timestamp = formatISOCompact(dt)
  const dirName = `${timestamp}__plaud_${recordingId}`
  return path.join(outDir, 'recordings', year, month, dirName)
}

/** Format: 2026-02-24T083012Z */
function formatISOCompact(dt: Date): string {
  const iso = dt.toISOString() // 2026-02-24T08:30:12.000Z
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace('T', 'T').slice(0, 16) + 'Z'
}

export function stateDir(outDir: string): string {
  return path.join(outDir, '_state')
}

export function syncStatePath(outDir: string): string {
  return path.join(stateDir(outDir), 'sync_state.json')
}

export function runLogsPath(outDir: string): string {
  return path.join(stateDir(outDir), 'run_logs.ndjson')
}

export function datasetPath(outDir: string): string {
  return path.join(outDir, 'datasets', 'plaud_transcripts.jsonl')
}

export function authTokenPath(): string {
  return path.join(os.homedir(), '.alta', 'plaud-auth.json')
}
