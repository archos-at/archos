const API_ERROR = Symbol.for('bff.ApiError')

export class ApiError extends Error {
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

Object.defineProperty(ApiError.prototype, API_ERROR, { value: true })

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError || (typeof error === 'object' && error !== null && API_ERROR in error)
}
