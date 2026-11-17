import type { RateLimitDecision } from '@/lib/limits/types'
import { ApiError, ForbiddenError } from './api-error'

export { ApiError, BadRequestError, ForbiddenError } from './api-error'

const BYTES_PER_MB = 1e6

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
  }
}

export class SessionRequiredError extends UnauthorizedError {
  constructor() {
    super('Unauthorized: Grid session required')
  }
}

export function isAuthzRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)
}

export class NoOrganizationError extends ForbiddenError {
  constructor() {
    super('Forbidden: no organization selected')
  }
}

export class OrgMemoryDisabledError extends ApiError {
  constructor(message = 'Agent organization-scoped memory is disabled') {
    super(403, 'ORG_MEMORY_DISABLED', message)
  }
}

export class TemporaryConversationError extends ApiError {
  constructor(message = 'This conversation is temporary: nothing from it is kept in memory') {
    super(403, 'TEMPORARY_CONVERSATION', message)
  }
}

export class ConversationConfinedError extends ApiError {
  constructor(
    readonly action: 'deepResearch' | 'task' | 'profilePatch' | 'memory' | 'filing' | 'revision' | 'planDocument',
    message: string
  ) {
    super(403, 'CONVERSATION_CONFINED', message, { action })
  }
}

export class CrossProjectAudienceChangedError extends ApiError {
  constructor(message: string) {
    super(409, 'CROSS_PROJECT_AUDIENCE_CHANGED', message)
  }
}

export class CrossProjectMemoryError extends ApiError {
  constructor(message: string) {
    super(409, 'CROSS_PROJECT_MEMORY', message)
  }
}

export const RIGHTS_LOST_REASON = 'rights-lost'

export class ResourceRightsLostError extends ApiError {
  constructor(readonly resourceType: string) {
    super(403, 'RESOURCE_RIGHTS_LOST', 'You no longer have the rights to view this content.', {
      reason: RIGHTS_LOST_REASON,
      resourceType,
    })
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message)
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details)
  }
}

export class UnprocessableError extends ApiError {
  constructor(message = 'Unprocessable', details?: unknown) {
    super(422, 'UNPROCESSABLE', message, details)
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(limitBytes?: number) {
    super(
      413,
      'PAYLOAD_TOO_LARGE',
      limitBytes
        ? `Request body exceeds the maximum accepted size of ${formatMegabytes(limitBytes)} MB`
        : 'Request body exceeds the maximum accepted size',
      limitBytes ? { limitBytes } : undefined
    )
  }
}

export function formatMegabytes(bytes: number): string {
  return String(Math.round((bytes / BYTES_PER_MB) * 10) / 10)
}

export class FileTooLargeError extends ApiError {
  constructor(details: { fileSize: number; maxSizeBytes: number }) {
    super(
      413,
      'FILE_TOO_LARGE',
      `File exceeds the maximum upload size of ${formatMegabytes(details.maxSizeBytes)} MB`,
      details
    )
  }
}

export class InsufficientStorageError extends ApiError {
  constructor(
    message = 'Storage quota exceeded',
    details?: { quotaBytes: number; usedBytes: number; requestedBytes: number }
  ) {
    super(507, 'STORAGE_QUOTA_EXCEEDED', message, details)
  }
}

export class TooManyRequestsError extends ApiError {
  readonly retryAfterSeconds: number

  constructor(decision: RateLimitDecision, message = 'Too many requests') {
    super(429, 'RATE_LIMITED', message, {
      policy: decision.rule,
      retryAfterSeconds: decision.retryAfterSeconds,
    })
    this.retryAfterSeconds = decision.retryAfterSeconds
    this.decision = decision
  }

  readonly decision: RateLimitDecision
}

export class UpstreamError extends ApiError {
  constructor(message = 'Upstream service error', details?: unknown) {
    super(502, 'UPSTREAM_ERROR', message, details)
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service unavailable', details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, details)
  }
}
