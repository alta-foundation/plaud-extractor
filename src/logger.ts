import pino from 'pino'
import { runLogsPath } from './storage/paths.js'

export type Logger = pino.Logger

let _logger: pino.Logger | null = null

export function createLogger(outDir: string, opts?: { verbose?: boolean; redact?: boolean }): pino.Logger {
  const level = process.env['LOG_LEVEL'] ?? (opts?.verbose ? 'debug' : 'info')

  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino/file',
      options: { destination: runLogsPath(outDir), mkdir: true },
      level: 'debug',
    },
    {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
      level,
    },
  ]

  const redactPaths = opts?.redact
    ? ['authToken', 'cookies', '*.value', 'Authorization', '*.Authorization']
    : []

  _logger = pino(
    {
      level: 'debug',
      redact: redactPaths.length > 0 ? { paths: redactPaths, censor: '[REDACTED]' } : undefined,
    },
    pino.transport({ targets }),
  )

  return _logger
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    // Fallback: stdout-only logger for when SDK is used without init
    _logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' })
  }
  return _logger
}

export function setLogger(logger: pino.Logger): void {
  _logger = logger
}
