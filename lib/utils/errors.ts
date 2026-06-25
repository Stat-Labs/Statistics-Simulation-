export class StatLabError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message)
    this.name = 'StatLabError'
  }
}

export const ErrorCodes = {
  NO_FILE: 'NO_FILE',
  INVALID_FILE: 'INVALID_FILE',
  PARSE_FAILED: 'PARSE_FAILED',
  COMPUTATION_FAILED: 'COMPUTATION_FAILED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const

export function isStatLabError(err: unknown): err is StatLabError {
  return err instanceof StatLabError
}

export function toErrorResponse(err: unknown): { success: false; error: string; code?: string } {
  if (isStatLabError(err)) {
    return { success: false, error: err.message, code: err.code }
  }
  if (err instanceof Error) {
    return { success: false, error: err.message }
  }
  return { success: false, error: 'An unexpected error occurred' }
}
