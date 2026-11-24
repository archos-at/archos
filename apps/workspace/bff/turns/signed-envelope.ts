import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import type { ContextKind } from '@/lib/conversation-context/types'
import { resolveTurnContext } from './turn-context'
import { turnContextHeaders } from './turn-headers.js'

const ENVELOPE_HEADERS = ['x-request-context', 'x-request-context-sig'] as const

export async function signedEnvelopeHeaders(
  session: AuthorizedSession,
  projectId: string | undefined,
  secret: string,
  kind: ContextKind
): Promise<Record<string, string>> {
  const context = await resolveTurnContext(session, { projectId, kind })
  const headers = turnContextHeaders(context, { issuedAt: Date.now(), secret })
  return Object.fromEntries(ENVELOPE_HEADERS.flatMap((name) => (headers[name] ? [[name, headers[name]]] : [])))
}
