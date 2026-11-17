import 'server-only'

import { BucketedRateLimiter, type Logger } from '@posthog/core'
import {
  createOnRequestError,
  type NextOnRequestError,
  type OnRequestErrorBeforeCaptureContext,
  type OnRequestErrorOptions,
} from '@posthog/next'

import { isAuthzRefusal } from '@/lib/api/errors'
import { isProjectClosedBody } from '@/lib/projects/project-status'

import { isFrameworkControlFlow } from './control-flow-error'
import { getTenantContext } from '@/lib/db/tenant-context'

import { posthogServerSettings, organizationProperties, serverSuperProperties } from './posthog-server'
import { scrubServerEvent } from './scrub-server-event'

export const REQUEST_ERROR_BURST = 5
export const REQUEST_ERROR_WINDOW_MS = 5 * 60_000
const MESSAGE_FINGERPRINT_LENGTH = 120
const UNKNOWN_ACTION_MESSAGE = 'Failed to find Server Action.'

const CLIENT_DISCONNECT_MESSAGE = 'The destination stream closed early.'

const quietLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: (...args: unknown[]) => console.warn('[posthog]', ...args),
  error: (...args: unknown[]) => console.error('[posthog]', ...args),
  critical: (...args: unknown[]) => console.error('[posthog]', ...args),
  createLogger: () => quietLogger,
}

const newLimiter = (): BucketedRateLimiter<string> =>
  new BucketedRateLimiter<string>({
    bucketSize: REQUEST_ERROR_BURST + 1,
    refillRate: REQUEST_ERROR_BURST + 1,
    refillInterval: REQUEST_ERROR_WINDOW_MS,
    _logger: quietLogger,
    _onBucketRateLimited: (key) =>
      console.warn('[posthog] request error rate-limited:', key.slice(0, 160)),
  })

let limiter = newLimiter()
let handler: NextOnRequestError | null = null

const fingerprintOf = ({ error, context }: OnRequestErrorBeforeCaptureContext): string => {
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  return `${context.routePath ?? ''}|${name}|${message.slice(0, MESSAGE_FINGERPRINT_LENGTH)}`
}

const isUnknownActionError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith(UNKNOWN_ACTION_MESSAGE)

const isClientDisconnect = (error: unknown): boolean =>
  error instanceof Error && error.message === CLIENT_DISCONNECT_MESSAGE

const FORM_BODY_PARSE_MESSAGE = 'Failed to parse body as FormData.'

const isUnparseableFormBody = (error: unknown): boolean =>
  error instanceof Error && error.message === FORM_BODY_PARSE_MESSAGE

const isProjectClosedRefusal = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  return isProjectClosedBody({ details: (error as { details?: unknown }).details })
}

export const beforeCapture = (
  capture: OnRequestErrorBeforeCaptureContext
): Record<string, unknown> | false => {
  if (isAuthzRefusal(capture.error)) return false
  if (isFrameworkControlFlow(capture.error)) return false
  if (isUnknownActionError(capture.error)) return false
  if (isClientDisconnect(capture.error)) return false
  if (isUnparseableFormBody(capture.error)) return false
  if (isProjectClosedRefusal(capture.error)) return false
  if (limiter.consumeRateLimit(fingerprintOf(capture))) return false
  const scope = getTenantContext()
  const organizationId = scope?.kind === 'tenant' ? scope.organizationId : null
  return {
    source: 'bff-on-request-error',
    ...serverSuperProperties(),
    ...(organizationId ? organizationProperties(organizationId) : {}),
  }
}

export const requestErrorOptions = (): OnRequestErrorOptions | null => {
  const settings = posthogServerSettings()
  if (!settings) return null
  return {
    apiKey: settings.projectToken,
    host: settings.host,
    serverOptions: { disableGeoip: true, before_send: scrubServerEvent },
    beforeCapture,
  }
}

export const requestErrorHandler = (): NextOnRequestError | null => {
  if (handler) return handler
  const options = requestErrorOptions()
  if (!options) return null
  handler = createOnRequestError(options)
  return handler
}

export const resetRequestErrorHandlerForTests = (): void => {
  handler = null
  limiter = newLimiter()
}
