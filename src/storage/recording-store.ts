import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic, writeStreamAtomic } from './atomic.js'
import { writeChecksumManifest, verifyChecksums } from './checksums.js'
import { toPlainText, toMarkdown } from '../transcript/formatter.js'
import { recordingDir } from './paths.js'
import type { PlaudRecording, PlaudTranscript } from '../client/types.js'
import type { ChecksumMismatchError } from '../errors.js'
import type { HttpClient } from '../client/http.js'
import { getLogger } from '../logger.js'

export type TranscriptFormat = 'json' | 'txt' | 'md'

export interface RecordingWriteResult {
  dir: string
  hasAudio: boolean
  hasTranscript: boolean
}

export class RecordingStore {
  constructor(private readonly outDir: string) {}

  recordingDir(recording: PlaudRecording): string {
    return recordingDir(this.outDir, recording.recordedAt, recording.id)
  }

  async writeMetadata(recording: PlaudRecording): Promise<string> {
    const dir = this.recordingDir(recording)
    const meta = buildMetaJson(recording)
    await writeFileAtomic(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    getLogger().debug({ recordingId: recording.id, dir }, 'Wrote meta.json')
    return dir
  }

  async writeTranscript(
    recording: PlaudRecording,
    transcript: PlaudTranscript,
    formats: TranscriptFormat[] = ['json', 'txt', 'md'],
  ): Promise<void> {
    const dir = this.recordingDir(recording)

    if (formats.includes('json')) {
      const json = {
        recordingId: transcript.recordingId,
        language: transcript.language,
        duration: transcript.duration,
        segments: transcript.segments,
      }
      await writeFileAtomic(path.join(dir, 'transcript.json'), JSON.stringify(json, null, 2))
    }

    if (formats.includes('txt')) {
      const txt = toPlainText(transcript)
      await writeFileAtomic(path.join(dir, 'transcript.txt'), txt)
    }

    if (formats.includes('md')) {
      const md = toMarkdown(transcript, recording)
      await writeFileAtomic(path.join(dir, 'transcript.md'), md)
    }

    getLogger().debug({ recordingId: recording.id, formats }, 'Wrote transcript files')
  }

  async writeAudio(recording: PlaudRecording, http: HttpClient): Promise<boolean> {
    const url = await this.getAudioUrl(recording, http)
    if (!url) return false

    const dir = this.recordingDir(recording)
    const ext = guessAudioExtension(recording.mimeType)
    const destPath = path.join(dir, `audio.${ext}`)

    try {
      const stream = await http.getStream(url)
      await writeStreamAtomic(destPath, stream)
      getLogger().debug({ recordingId: recording.id, path: destPath }, 'Wrote audio file')
      return true
    } catch (err) {
      getLogger().warn({ recordingId: recording.id, err }, 'Failed to download audio')
      return false
    }
  }

  private async getAudioUrl(recording: PlaudRecording, http: HttpClient): Promise<string | null> {
    // This is a stub — the PlaudApiClient resolves the actual URL
    // RecordingStore receives the already-resolved URL via writeAudioFromUrl
    return null
  }

  async writeAudioFromUrl(recording: PlaudRecording, url: string, http: HttpClient): Promise<boolean> {
    const dir = this.recordingDir(recording)
    const ext = guessAudioExtension(recording.mimeType)
    const destPath = path.join(dir, `audio.${ext}`)

    try {
      // S3 presigned URLs must be fetched without Plaud auth headers
      const stream = await http.downloadExternalUrl(url)
      await writeStreamAtomic(destPath, stream)
      getLogger().debug({ recordingId: recording.id, path: destPath }, 'Wrote audio file')
      return true
    } catch (err) {
      getLogger().warn({ recordingId: recording.id, err }, 'Failed to download audio')
      return false
    }
  }

  async writeChecksums(recording: PlaudRecording): Promise<void> {
    const dir = this.recordingDir(recording)
    await writeChecksumManifest(dir, recording.id)
    getLogger().debug({ recordingId: recording.id }, 'Wrote checksums.json')
  }

  async verify(recording: PlaudRecording): Promise<ChecksumMismatchError[]> {
    const dir = this.recordingDir(recording)
    return verifyChecksums(dir)
  }

  async exists(recording: PlaudRecording): Promise<boolean> {
    const dir = this.recordingDir(recording)
    try {
      await fs.access(dir)
      return true
    } catch {
      return false
    }
  }

  async hasMissingFiles(recording: PlaudRecording): Promise<boolean> {
    const dir = this.recordingDir(recording)
    const required = ['meta.json']
    for (const file of required) {
      try {
        await fs.access(path.join(dir, file))
      } catch {
        return true
      }
    }
    return false
  }
}

function buildMetaJson(recording: PlaudRecording): object {
  return {
    source: 'plaud',
    source_recording_id: recording.id,
    recorded_at: recording.recordedAt,
    imported_at: new Date().toISOString(),
    title: recording.title,
    duration_seconds: recording.duration,
    language: recording.language,
    audio: recording.fileSize
      ? {
          filename: `audio.${guessAudioExtension(recording.mimeType)}`,
          mime: recording.mimeType,
          bytes: recording.fileSize,
        }
      : null,
    transcript: {
      has_timestamps: true, // will be updated after writing
      format: 'segments',
      filename_json: 'transcript.json',
      filename_txt: 'transcript.txt',
      filename_md: 'transcript.md',
    },
    integrity: {
      dedupe_key: `plaud:${recording.id}`,
    },
    tags: recording.tags,
    folder_id: recording.folderId,
    device_id: recording.deviceId,
    summary: recording.summary,
  }
}

function guessAudioExtension(mimeType: string): string {
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('webm')) return 'webm'
  return 'm4a' // default
}
