const API_ERROR = Symbol.for('archos.ApiError')

export class ApiError extends Error {
  readonly [API_ERROR] = true

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details)
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', details?: unknown) {
    super(403, 'FORBIDDEN', message, details)
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError || (typeof error === 'object' && error !== null && API_ERROR in error)
}
