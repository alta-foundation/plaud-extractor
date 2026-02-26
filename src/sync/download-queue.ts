import { ApiError } from '../errors.js'
import { getLogger } from '../logger.js'

export interface QueueResult<T> {
  succeeded: T[]
  failed: Array<{ item: T; error: Error }>
}

/**
 * Process items with bounded concurrency.
 * Uses a simple semaphore — no extra dependencies.
 */
export async function processQueue<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency: number,
): Promise<QueueResult<T>> {
  const succeeded: T[] = []
  const failed: Array<{ item: T; error: Error }> = []

  let index = 0
  let active = 0
  let resolve: (() => void) | null = null

  const tick = async (): Promise<void> => {
    while (active < concurrency && index < items.length) {
      const item = items[index++]!
      active++

      ;(async () => {
        try {
          await processor(item)
          succeeded.push(item)
        } catch (err) {
          failed.push({ item, error: err instanceof Error ? err : new Error(String(err)) })
        } finally {
          active--
          if (resolve) {
            const r = resolve
            resolve = null
            r()
          }
        }
      })().catch(() => undefined)
    }
  }

  await tick()

  while (active > 0 || index < items.length) {
    await new Promise<void>(r => { resolve = r })
    await tick()
  }

  return { succeeded, failed }
}

/**
 * Retry a function with exponential backoff.
 * Only retries if the error is retryable (isRetryable === true for ApiError).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; label?: string } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4
  const delays = [0, 1000, 4000, 16000]
  const log = getLogger()

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const isLast = attempt === maxAttempts
      const retryable = isRetryableError(err)

      if (isLast || !retryable) {
        if (attempt > 1) {
          log.warn({ attempt, label: opts.label, err }, 'Giving up after retries')
        }
        throw err
      }

      const delay = delays[attempt] ?? 16000
      log.debug({ attempt, delay, label: opts.label }, 'Retrying after delay')
      await sleep(delay)
    }
  }

  // Unreachable — TypeScript needs this
  throw new Error('Retry loop exhausted')
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof ApiError) return err.isRetryable
  if (err instanceof Error && err.message.includes('429')) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
