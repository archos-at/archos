/**
 * What an agent at the door may take of an office's licensed copy (ADR-0159, design 6.4 and E19).
 *
 * The agent door (`/api/mcp`) reaches a document through the routes a person's
 * browser uses, so the same handler serves the person's own text pane and an
 * agent's `document-text-get`. Only the agent is held here, told apart by the
 * acting session's reader (`actingReaderIsAgent`): the person reads their
 * office's copy whole, as the licence allows them.
 *
 * - **Access first.** A document the person cannot open is a 404 before any
 *   licence is read, so a refusal never says a copy exists.
 * - **Files, links and versions** (`document-file-get`, `document-download`,
 *   `document-preview-get`, `document-thumbnail-get`, `document-version-content-get`,
 *   `document-version-diff`) of a licensed copy are not sent to an agent at all:
 *   each is the whole norm, past any quote cap.
 * - **Held copies.** Any base-knowledge copy whose text is held (`textHeldFor`: no
 *   person confirmed it, whatever its class, or it is licensed and unattested) gives
 *   an agent no text and no bytes: `BASE_COPY_HELD`, one code for all of it.
 * - **Text** (`document-text-get`) of a confirmed, attested licensed copy: each
 *   agent reads at most three times the licence's `quoteMaxChars` of one
 *   edition per person and calendar day (UTC), cumulatively, and a call past
 *   that is refused (E19: a session that reads a norm 500 characters at a time
 *   stops there).
 * - **Search snippets** (`workspace-search`, `passage-similar-search`) of a
 *   licensed copy reach an agent as a note: repeated queries would otherwise
 *   collect the norm a snippet at a time. The hit, its page and its document stay.
 *
 * The door is stateless (no MCP session id), so "session" is the person and a
 * day. The counter is the shared cache's, added to atomically (`incrementCounter`),
 * keyed by the edition so a second upload of the same copy does not reset it. If
 * the cache is down, each call is still cut to the whole budget, so no single
 * answer carries more.
 */

import 'server-only'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { ApiError } from '@/lib/api/api-error'
import type { AuthorizedSession } from '@/lib/auth/types'
import { incrementCounter } from '@/lib/cache'
import { getAccessibleDocument } from '@/lib/documents/access'
import type { SearchResponse } from '@/lib/search/search-wire'
import type { SimilarPassagesResponse } from '@/lib/similar-passages/types'
import { licenceOfDocument } from './text-guard'

/** How many quote caps of one licensed edition an agent may read through the door, per person and day. */
export const DOOR_QUOTE_FACTOR = 3

/** How long a day's counter is kept: the day it names, and a margin for a clock at its edge. */
export const DOOR_QUOTE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

/** What a licensed copy's search snippet becomes for an agent. */
export const LICENSED_SNIPPET_NOTE =
  '[Licensed copy: its passage is not sent to an agent. Name the document, page and clause.]'

type Licence = NonNullable<Awaited<ReturnType<typeof licenceOfDocument>>>

/**
 * The record of a document an AGENT asks for, when the door holds it: a licensed copy, or any copy whose text is
 * held (`textHeldFor`: unconfirmed, whatever its class, or licensed and unattested). Null for a person or any
 * other document.
 */
async function guardedCopyForAgent(
  session: AuthorizedSession,
  documentId: string
): Promise<Licence | null> {
  if (!actingReaderIsAgent()) return null
  // A copy the person cannot open is not found, whatever its licence: the refusal below would say it exists.
  await getAccessibleDocument(session, documentId)
  let licence: Awaited<ReturnType<typeof licenceOfDocument>>
  try {
    licence = await licenceOfDocument(session.organizationId, documentId)
  } catch {
    // The records cannot be read: for an agent, a copy we cannot classify is treated as licensed and unattested.
    throw notSent(
      'LICENSED_COPY_UNKNOWN',
      'Whether this document is a licensed copy could not be read; try again.'
    )
  }
  return licence?.licensed || licence?.held ? licence : null
}

/** One answer for every held copy: nothing of it reaches an agent until a person confirms it (ADR-0158). */
function held(): ApiError {
  return notSent(
    'BASE_COPY_HELD',
    'This copy in the office’s base knowledge is held: no person has confirmed it, or its licence does not cover ' +
      'processing by AI services. No text or file of it is sent. Name the document, its edition and the clause.'
  )
}

function notSent(code: string, message: string): ApiError {
  return new ApiError(403, code, message)
}

/** Refuse a licensed copy's file, link or version to an agent. A person, and every other document, pass. */
export async function refuseLicensedFileForAgent(
  session: AuthorizedSession,
  documentId: string
): Promise<void> {
  const copy = await guardedCopyForAgent(session, documentId)
  if (!copy) return
  if (copy.held) throw held()
  throw notSent(
    'LICENSED_COPY_NOT_SENT',
    'This is the office’s licensed copy of a standard: its file, versions and links are not sent to an agent. ' +
      'Search it with knowledge-search to find the place, and name the document, page and clause.'
  )
}

/** The day's counter of one person's reads of one edition. */
function doorQuoteKey(session: AuthorizedSession, licence: Licence, documentId: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return `org:${session.organizationId}:door-quote:${day}:${session.userId}:${licence.editionId || documentId}`
}

function capReached(budget: number): ApiError {
  return notSent(
    'LICENSED_QUOTE_CAP_REACHED',
    `This licensed copy has given an agent its ${budget} characters for today. Quote what was read, and name ` +
      'the document, page and clause for the rest.'
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
  const licence = await guardedCopyForAgent(session, documentId)
  if (!licence) return read()
  if (licence.held || !licence.aiProcessingAttested) throw held()
  const budget = DOOR_QUOTE_FACTOR * licence.quoteMaxChars
  const key = doorQuoteKey(session, licence, documentId)
  const used = (await incrementCounter(key, 0, DOOR_QUOTE_WINDOW_MS)) ?? 0
  if (used >= budget) throw capReached(budget)
  const preview = await read()
  const wanted = preview.text.slice(0, budget - used)
  // The add is atomic: two calls in flight cannot both spend what is left. Past the budget, this call keeps less.
  const total = await incrementCounter(key, wanted.length, DOOR_QUOTE_WINDOW_MS)
  const text =
    total === null
      ? wanted
      : wanted.slice(0, Math.max(0, wanted.length - Math.max(0, total - budget)))
  if (wanted.length > 0 && text.length === 0) throw capReached(budget)
  return { ...preview, text, truncated: preview.truncated || text.length < preview.text.length }
}

/**
 * The documents among `documentIds` whose passages an AGENT may not see: licensed copies, held copies, and any
 * whose record cannot be read (fail closed). Empty for a person.
 */
export async function licensedCopiesForAgent(
  session: AuthorizedSession,
  documentIds: string[]
): Promise<Set<string>> {
  if (!actingReaderIsAgent()) return new Set()
  const verdicts = await Promise.all(
    [...new Set(documentIds)].map(async (id) => {
      try {
        const copy = await licenceOfDocument(session.organizationId, id)
        return copy?.licensed || copy?.held ? id : null
      } catch {
        return id
      }
    })
  )
  return new Set(verdicts.filter((id): id is string => id !== null))
}

/** A search response as an agent may receive it: a licensed copy's passage replaced by the note. */
export async function searchForAgent(
  session: AuthorizedSession,
  response: SearchResponse
): Promise<SearchResponse> {
  const section = response.sections.document
  if (!section || !actingReaderIsAgent()) return response
  const withPassage = section.hits.filter((hit) => hit.passage)
  const licensed = await licensedCopiesForAgent(
    session,
    withPassage.map((hit) => hit.id)
  )
  if (licensed.size === 0) return response
  const hits = section.hits.map((hit) =>
    hit.passage && licensed.has(hit.id)
      ? { ...hit, passage: { ...hit.passage, text: LICENSED_SNIPPET_NOTE } }
      : hit
  )
  return { ...response, sections: { ...response.sections, document: { ...section, hits } } }
}

/** Similar passages as an agent may receive them: a licensed copy's snippets replaced by the note. */
export async function similarForAgent(
  session: AuthorizedSession,
  response: SimilarPassagesResponse
): Promise<SimilarPassagesResponse> {
  if (!actingReaderIsAgent()) return response
  const ids = response.groups.flatMap((group) =>
    group.documents.map((document) => document.documentId)
  )
  const licensed = await licensedCopiesForAgent(session, ids)
  if (licensed.size === 0) return response
  return {
    ...response,
    groups: response.groups.map((group) => ({
      ...group,
      documents: group.documents.map((document) =>
        licensed.has(document.documentId)
          ? {
              ...document,
              passages: document.passages.map((passage) => ({
                ...passage,
                snippet: LICENSED_SNIPPET_NOTE,
              })),
            }
          : document
      ),
    })),
  }
}
