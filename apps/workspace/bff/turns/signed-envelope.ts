import 'server-only'
/**
 * The signed request-context envelope of a call the BFF makes to the Python
 * backend for a person, outside a chat turn (ADR-0054, ADR-0122).
 *
 * The backend cannot decide project access, so the BFF builds the context of a
 * turn in `projectId` for this session (`resolveTurnContext`, which authorizes
 * the project and reads the budget), signs it with the shared secret, and
 * sends only the two envelope headers: the backend takes the person, the
 * organization, the project and the collection scope from the envelope alone.
 * The agent door's read tools (`agent-api/backend-operations.ts`) and the
 * review view's tape (`drawing-tape/service.ts`) both sign through here.
 */

import type { AuthorizedSession } from '@/lib/auth/types'
import { resolveTurnContext } from './turn-context'
import { turnContextHeaders } from './turn-headers.js'

const ENVELOPE_HEADERS = ['x-request-context', 'x-request-context-sig'] as const

/** The two envelope headers for `session` in `projectId`, signed now; nothing else of a turn's headers. */
export async function signedEnvelopeHeaders(
  session: AuthorizedSession,
  projectId: string | undefined,
  secret: string
): Promise<Record<string, string>> {
  const context = await resolveTurnContext(session, { projectId })
  const headers = turnContextHeaders(context, { issuedAt: Date.now(), secret })
  return Object.fromEntries(ENVELOPE_HEADERS.flatMap((name) => (headers[name] ? [[name, headers[name]]] : [])))
}
