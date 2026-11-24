import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import { resolveTurnContext } from './turn-context'
import { turnContextHeaders } from './turn-headers.js'

const ENVELOPE_HEADERS = ['x-request-context', 'x-request-context-sig'] as const

export async function signedEnvelopeHeaders(
  session: AuthorizedSession,
  projectId: string | undefined,
  secret: string
): Promise<Record<string, string>> {
  const context = await resolveTurnContext(session, { projectId })
  const headers = turnContextHeaders(context, { issuedAt: Date.now(), secret })
  return Object.fromEntries(ENVELOPE_HEADERS.flatMap((name) => (headers[name] ? [[name, headers[name]]] : [])))
}
