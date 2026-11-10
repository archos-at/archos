/**
 * What an agent at the door may take of an office's licensed copy (ADR-0159, design 6.4 and E19).
 *
 * The agent door (`/api/mcp`) reaches a document through the routes a person's
 * browser uses, so the same handler serves the person's own text pane and an
 * agent's `document-text-get`. Only the agent is held here, told apart by the
 * acting session's reader (`actingReaderIsAgent`): the person reads their
 * office's copy whole, as the licence allows them.
 *
 * - **Files and links** (`document-file-get`, `document-download`,
 *   `document-preview-get`, `document-thumbnail-get`) of a licensed copy are not sent to an agent at all:
 *   a PDF or a presigned link is the whole norm, past any quote cap.
 * - **Text** (`document-text-get`) of a licensed copy is refused while the copy
 *   is unconfirmed or its office has not attested AI processing; otherwise each
 *   agent reads at most three times the licence's `quoteMaxChars` of one
 *   document per person and day, cumulatively, and a call past that is refused
 *   (E19: a session that reads a norm 500 characters at a time stops there).
 *
 * The door is stateless (no MCP session id), so "session" is the person and a
 * day. The counter is the shared cache's; if the cache is down, each call is
 * still cut to the whole budget, so no single answer carries more.
 */

import 'server-only'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { ApiError } from '@/lib/api/api-error'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getCached, setCached } from '@/lib/cache'
import { licenceOfDocument } from './text-guard'

/** How many quote caps of one licensed document an agent may read through the door, per person and day. */
export const DOOR_QUOTE_FACTOR = 3

/** The window a door "session" spans: the door has no session id, so a person's reads within a day add up. */
export const DOOR_QUOTE_WINDOW_MS = 24 * 60 * 60 * 1000

type Licence = NonNullable<Awaited<ReturnType<typeof licenceOfDocument>>>

/** The licence of a document an AGENT asks for, when it is a licensed copy; null for a person or any other document. */
async function licensedCopyForAgent(session: AuthorizedSession, documentId: string): Promise<Licence | null> {
  if (!actingReaderIsAgent()) return null
  let licence: Awaited<ReturnType<typeof licenceOfDocument>>
  try {
    licence = await licenceOfDocument(session.organizationId, documentId)
  } catch {
    // The records cannot be read: for an agent, a copy we cannot classify is treated as licensed and unattested.
    throw notSent('LICENSED_COPY_UNKNOWN', 'Whether this document is a licensed copy could not be read; try again.')
  }
  return licence?.licensed ? licence : null
}

function notSent(code: string, message: string): ApiError {
  return new ApiError(403, code, message)
}

/** Refuse a licensed copy's file or link to an agent. A person, and every other document, pass. */
export async function refuseLicensedFileForAgent(session: AuthorizedSession, documentId: string): Promise<void> {
  if (!(await licensedCopyForAgent(session, documentId))) return
  throw notSent(
    'LICENSED_COPY_NOT_SENT',
    'This is the office’s licensed copy of a standard: its file and links are not sent to an agent. ' +
      'Search it with knowledge-search to find the place, and name the document, page and clause.'
  )
}

/**
 * The text of a document as an agent may receive it: whole for a person or an unlicensed document; for a licensed
 * copy, refused when it may reach no model, otherwise cut to what is left of the agent's cumulative quote budget.
 */
export async function doorTextOf<T extends { text: string; truncated: boolean }>(
  session: AuthorizedSession,
  documentId: string,
  read: () => Promise<T>
): Promise<T> {
  const licence = await licensedCopyForAgent(session, documentId)
  if (!licence) return read()
  if (!licence.confirmed || !licence.aiProcessingAttested) {
    throw notSent(
      'LICENSED_TEXT_WITHHELD',
      'This is the office’s licensed copy of a standard, and the office has not confirmed that its licence covers ' +
        'processing by AI services: no text of it is sent. Name the document, its edition and the clause.'
    )
  }
  const budget = DOOR_QUOTE_FACTOR * licence.quoteMaxChars
  const key = `org:${session.organizationId}:door-quote:${session.userId}:${documentId}`
  const used = await getCached<number>(key, DOOR_QUOTE_WINDOW_MS, async () => 0)
  const left = Math.max(0, budget - (typeof used === 'number' ? used : 0))
  if (left === 0) {
    throw notSent(
      'LICENSED_QUOTE_CAP_REACHED',
      `This licensed copy has given an agent its ${budget} characters for today. Quote what was read, and name ` +
        'the document, page and clause for the rest.'
    )
  }
  const preview = await read()
  const text = preview.text.slice(0, left)
  await setCached(key, budget - left + text.length, DOOR_QUOTE_WINDOW_MS)
  return { ...preview, text, truncated: preview.truncated || text.length < preview.text.length }
}
