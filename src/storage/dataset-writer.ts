import fs from 'node:fs/promises'
import { createWriteStream, type WriteStream } from 'node:fs'
import path from 'node:path'
import { datasetPath, recordingDir } from './paths.js'
import type { PlaudRecording, PlaudTranscript } from '../client/types.js'
import { StorageError } from '../errors.js'

export interface DatasetEntry {
  id: string
  title: string | null
  recorded_at: string
  duration_seconds: number
  language: string | null
  text: string
  path: string
  segment_count: number
}

export class DatasetWriter {
  private readonly filePath: string
  private stream: WriteStream | null = null

  constructor(outDir: string) {
    this.filePath = datasetPath(outDir)
  }

  async open(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    this.stream = createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' })
    await new Promise<void>((resolve, reject) => {
      this.stream!.once('open', () => resolve())
      this.stream!.once('error', reject)
    })
  }

  async append(outDir: string, recording: PlaudRecording, transcript: PlaudTranscript): Promise<void> {
    if (!this.stream) throw new StorageError('DatasetWriter not opened', this.filePath)

    const relPath = path.relative(
      outDir,
      path.join(recordingDir(outDir, recording.recordedAt, recording.id), 'transcript.txt'),
    )

    const entry: DatasetEntry = {
      id: `plaud:${recording.id}`,
      title: recording.title ?? null,
      recorded_at: recording.recordedAt,
      duration_seconds: recording.duration,
      language: recording.language ?? null,
      text: transcript.fullText,
      path: relPath,
      segment_count: transcript.segments.length,
    }

    const line = JSON.stringify(entry) + '\n'

    await new Promise<void>((resolve, reject) => {
      this.stream!.write(line, err => (err ? reject(err) : resolve()))
    })
  }

  async close(): Promise<void> {
    if (!this.stream) return
    await new Promise<void>((resolve, reject) => {
      this.stream!.end(() => resolve())
      this.stream!.once('error', reject)
    })
    this.stream = null
  }

  get path(): string {
    return this.filePath
  }
}
