import { AuthError, StorageError } from '../errors.js'

export enum ExitCode {
  Success = 0,
  PartialFailure = 1,
  AuthFailure = 2,
  StorageError = 3,
}

export function toExitCode(err: unknown): ExitCode {
  if (err instanceof AuthError) return ExitCode.AuthFailure
  if (err instanceof StorageError) return ExitCode.StorageError
  return ExitCode.PartialFailure
}
