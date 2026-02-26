import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { stateDir } from '../storage/paths.js'
import { PlaudExtractor } from '../PlaudExtractor.js'
import { getLogger } from '../logger.js'
import type { SyncResult } from '../sync/types.js'

// ─── Job state ─────────────────────────────────────────────────────────────────

type JobStatus = 'running' | 'completed' | 'failed'

interface JobState {
  id: string
  type: 'sync' | 'backfill'
  status: JobStatus
  startedAt: string
  completedAt?: string
  result?: Partial<SyncResult>
  error?: string
}

function jobsDir(outDir: string): string {
  return path.join(stateDir(outDir), 'jobs')
}

async function writeJob(outDir: string, state: JobState): Promise<void> {
  await fs.mkdir(jobsDir(outDir), { recursive: true })
  await fs.writeFile(
    path.join(jobsDir(outDir), `${state.id}.json`),
    JSON.stringify(state, null, 2),
  )
}

async function readJob(outDir: string, jobId: string): Promise<JobState | null> {
  try {
    const raw = await fs.readFile(path.join(jobsDir(outDir), `${jobId}.json`), 'utf8')
    return JSON.parse(raw) as JobState
  } catch {
    return null
  }
}

function newJobId(type: string): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const rand = crypto.randomBytes(3).toString('hex')
  return `${type}_${ts}_${rand}`
}

// ─── Async job runner ──────────────────────────────────────────────────────────

function runAsync(fn: () => Promise<void>): void {
  fn().catch(err => getLogger().error({ err }, 'Unhandled job error'))
}

// ─── Tool registration ─────────────────────────────────────────────────────────

export function registerJobTools(server: McpServer, outDir: string): void {

  // ── plaud_sync ─────────────────────────────────────────────────────────────

  server.tool(
    'plaud_sync',
    'Start an incremental sync (new/changed recordings only) in the background. Returns a jobId immediately — poll with plaud_job_status to check progress.',
    {
      since: z.string().optional().describe('ISO date — only sync recordings after this date'),
      limit: z.number().int().min(1).optional().describe('Max recordings to sync'),
      dryRun: z.boolean().default(false).describe('Preview without downloading'),
    },
    async ({ since, limit, dryRun }) => {
      const jobId = newJobId('sync')
      const job: JobState = { id: jobId, type: 'sync', status: 'running', startedAt: new Date().toISOString() }
      await writeJob(outDir, job)

      runAsync(async () => {
        try {
          const extractor = new PlaudExtractor({ outDir, logger: getLogger() })
          const result = await extractor.sync({
            since: since ? new Date(since) : undefined,
            limit,
            dryRun,
          })
          await writeJob(outDir, { ...job, status: 'completed', completedAt: new Date().toISOString(), result })
        } catch (err) {
          await writeJob(outDir, { ...job, status: 'failed', completedAt: new Date().toISOString(), error: String(err) })
        }
      })

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            jobId,
            status: 'running',
            message: `Sync started. Poll with: plaud_job_status({ jobId: "${jobId}" })`,
          }, null, 2),
        }],
      }
    },
  )

  // ── plaud_backfill ─────────────────────────────────────────────────────────

  server.tool(
    'plaud_backfill',
    'Re-evaluate and re-download all recordings in the background. Returns a jobId immediately — poll with plaud_job_status to check progress.',
    {
      limit: z.number().int().min(1).optional().describe('Max recordings to process'),
    },
    async ({ limit }) => {
      const jobId = newJobId('backfill')
      const job: JobState = { id: jobId, type: 'backfill', status: 'running', startedAt: new Date().toISOString() }
      await writeJob(outDir, job)

      runAsync(async () => {
        try {
          const extractor = new PlaudExtractor({ outDir, logger: getLogger() })
          const result = await extractor.backfill({ limit })
          await writeJob(outDir, { ...job, status: 'completed', completedAt: new Date().toISOString(), result })
        } catch (err) {
          await writeJob(outDir, { ...job, status: 'failed', completedAt: new Date().toISOString(), error: String(err) })
        }
      })

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            jobId,
            status: 'running',
            message: `Backfill started. Poll with: plaud_job_status({ jobId: "${jobId}" })`,
          }, null, 2),
        }],
      }
    },
  )

  // ── plaud_job_status ───────────────────────────────────────────────────────

  server.tool(
    'plaud_job_status',
    'Check the status of a background sync or backfill job.',
    {
      jobId: z.string().describe('The jobId returned by plaud_sync or plaud_backfill'),
    },
    async ({ jobId }) => {
      const job = await readJob(outDir, jobId)
      if (!job) {
        return { content: [{ type: 'text' as const, text: `Job not found: ${jobId}` }] }
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(job, null, 2) }] }
    },
  )
}
