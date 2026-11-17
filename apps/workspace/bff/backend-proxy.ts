import { NextResponse } from 'next/server'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { isAuthRequired } from '@/lib/auth/auth-required'
import type { UserSession } from '@/lib/auth/types'

export { isAuthRequired }

export { getBackendUrl } from '@/lib/backend-url'

export async function resolveOptionalSession(): Promise<UserSession | null> {
  if (!isAuthRequired()) {
    return null
  }
  return requireAuthorizedSession()
}

export function resolveBearerAuthHeader(req: Request, session: UserSession | null): string | null {
  const headerToken = req.headers.get('Authorization')
  return headerToken || (session?.accessToken ? `Bearer ${session.accessToken}` : null)
}

export function buildAuthHeaders(authHeader: string | null): Record<string, string> {
  return authHeader ? { Authorization: authHeader } : {}
}

export function errorEnvelope(status: number, code: string, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function backendErrorEnvelope(status: number, errorText: string): NextResponse {
  return errorEnvelope(status, 'BACKEND_ERROR', `Backend returned ${status}: ${errorText}`)
}

export function handleAuthzError(error: unknown): NextResponse {
  const status = error instanceof Error && error.message.toLowerCase() === 'not found' ? 404 : 403
  const code = status === 404 ? 'NOT_FOUND' : 'FORBIDDEN'

  return errorEnvelope(status, code, error instanceof Error ? error.message : 'Access denied')
}

export function proxyErrorEnvelope(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Unknown error'
  return errorEnvelope(500, 'PROXY_ERROR', message)
}

export function noResponseBodyEnvelope(message = 'Backend returned no response body'): NextResponse {
  return errorEnvelope(500, 'NO_RESPONSE_BODY', message)
}

export function sseStreamResponse(
  body: ReadableStream<Uint8Array>,
  extraHeaders?: Record<string, string>
): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...extraHeaders,
    },
  })
}
