export class PlaudError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'PlaudError'
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`
    }
  }
}

export class AuthError extends PlaudError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'AuthError'
  }
}

export class ApiError extends PlaudError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly recordingId?: string,
    cause?: unknown,
  ) {
    super(message, cause)
    this.name = 'ApiError'
  }

  get isRetryable(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429
  }
}

export class StorageError extends PlaudError {
  constructor(
    message: string,
    public readonly path: string,
    cause?: unknown,
  ) {
    super(message, cause)
    this.name = 'StorageError'
  }
}

export class ChecksumMismatchError extends PlaudError {
  constructor(
    public readonly filePath: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Checksum mismatch for ${filePath}: expected ${expected}, got ${actual}`)
    this.name = 'ChecksumMismatchError'
  }
}
