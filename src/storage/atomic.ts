import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { StorageError } from '../errors.js'

/** Write a file atomically: write to .tmp-<rand>, then rename. */
export async function writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
  const tmpPath = `${filePath}.tmp-${crypto.randomBytes(4).toString('hex')}`
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmpPath, data, { encoding: typeof data === 'string' ? 'utf8' : undefined })
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    // Clean up tmp file on failure
    await fs.unlink(tmpPath).catch(() => undefined)
    throw new StorageError(`Failed to write ${filePath}`, filePath, err)
  }
}

/** Stream a ReadableStream to a file atomically. */
export async function writeStreamAtomic(
  filePath: string,
  stream: AsyncIterable<Uint8Array> | NodeJS.ReadableStream,
): Promise<void> {
  const tmpPath = `${filePath}.tmp-${crypto.randomBytes(4).toString('hex')}`
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmpPath)
      out.on('finish', resolve)
      out.on('error', reject)

      if (Symbol.asyncIterator in stream) {
        ;(async () => {
          for await (const chunk of stream as AsyncIterable<Uint8Array>) {
            out.write(chunk)
          }
          out.end()
        })().catch(reject)
      } else {
        ;(stream as NodeJS.ReadableStream).pipe(out)
        ;(stream as NodeJS.ReadableStream).on('error', reject)
      }
    })
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => undefined)
    throw new StorageError(`Failed to write stream to ${filePath}`, filePath, err)
  }
}
