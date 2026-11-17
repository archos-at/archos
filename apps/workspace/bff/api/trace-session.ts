import { trace } from '@opentelemetry/api'

export const POSTHOG_SESSION_HEADER = 'x-posthog-session-id'

export const SESSION_ID_ATTRIBUTE = 'sessionId'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function browserSessionId(request: Request): string | undefined {
  const value = request.headers.get(POSTHOG_SESSION_HEADER)?.trim().toLowerCase()
  return value && UUID_V7.test(value) ? value : undefined
}

export function tagSpanWithBrowserSession(request: Request): void {
  const sessionId = browserSessionId(request)
  if (!sessionId) return
  const span = trace.getActiveSpan()
  if (span?.isRecording()) span.setAttribute(SESSION_ID_ATTRIBUTE, sessionId)
}
