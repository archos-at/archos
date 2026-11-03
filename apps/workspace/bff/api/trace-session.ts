import { trace } from '@opentelemetry/api'

/**
 * The header posthog-js adds to the app's own requests (`tracing_headers` in
 * `bff/analytics/posthog.ts`), carrying the browser's PostHog session id.
 */
export const POSTHOG_SESSION_HEADER = 'x-posthog-session-id'

/**
 * The span attribute PostHog Tracing reads to put a span on a session replay,
 * as posthog-node's own context processor writes it (`posthog-node/otel`).
 */
export const SESSION_ID_ATTRIBUTE = 'sessionId'

/** PostHog session ids are UUIDv7; the Python tiers check the same shape (`posthog_session_id_or_none`). */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The request's PostHog session id, or undefined for a missing or malformed header. Pure. */
export function browserSessionId(request: Request): string | undefined {
  const value = request.headers.get(POSTHOG_SESSION_HEADER)?.trim().toLowerCase()
  return value && UUID_V7.test(value) ? value : undefined
}

/**
 * Put the browser's session on the request's active span, so the trace opens
 * beside its replay in PostHog. A no-op without a session or a recording span
 * (no tracer provider, or a request the sampler dropped). The value came from
 * a browser, so anything that is not a session id is ignored, never an error.
 */
export function tagSpanWithBrowserSession(request: Request): void {
  const sessionId = browserSessionId(request)
  if (!sessionId) return
  const span = trace.getActiveSpan()
  if (span?.isRecording()) span.setAttribute(SESSION_ID_ATTRIBUTE, sessionId)
}
