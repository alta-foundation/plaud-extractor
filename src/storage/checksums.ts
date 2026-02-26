import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from './atomic.js'
import { ChecksumMismatchError } from '../errors.js'

export interface FileChecksum {
  sha256: string
  sizeBytes: number
}

export interface ChecksumManifest {
  schemaVersion: 1
  recordingId: string
  computedAt: string
  files: Record<string, FileChecksum>
}

export async function sha256File(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

export async function writeChecksumManifest(
  dir: string,
  recordingId: string,
): Promise<ChecksumManifest> {
  const files = await fs.readdir(dir)
  const manifest: ChecksumManifest = {
    schemaVersion: 1,
    recordingId,
    computedAt: new Date().toISOString(),
    files: {},
  }

  for (const file of files.filter(f => f !== 'checksums.json')) {
    const fPath = path.join(dir, file)
    const stat = await fs.stat(fPath)
    if (!stat.isFile()) continue
    manifest.files[file] = {
      sha256: await sha256File(fPath),
      sizeBytes: stat.size,
    }
  }

  await writeFileAtomic(path.join(dir, 'checksums.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

export async function verifyChecksums(dir: string): Promise<ChecksumMismatchError[]> {
  const manifestPath = path.join(dir, 'checksums.json')
  let manifest: ChecksumManifest

  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    manifest = JSON.parse(raw) as ChecksumManifest
  } catch {
    return [] // No manifest yet — skip verification
  }

  const mismatches: ChecksumMismatchError[] = []

  for (const [file, expected] of Object.entries(manifest.files)) {
    const fPath = path.join(dir, file)
    try {
      const actual = await sha256File(fPath)
      if (actual !== expected.sha256) {
        mismatches.push(new ChecksumMismatchError(fPath, expected.sha256, actual))
      }
    } catch {
      mismatches.push(new ChecksumMismatchError(fPath, expected.sha256, 'MISSING'))
    }
  }

  return mismatches
}
