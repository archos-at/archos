import 'server-only'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { ApiError } from '@/lib/api/api-error'
import type { AuthorizedSession } from '@/lib/auth/types'
import { incrementCounter } from '@/lib/cache'
import { getAccessibleDocument } from '@/lib/documents/access'
import type { SearchResponse } from '@/lib/search/search-wire'
import type { SimilarPassagesResponse } from '@/lib/similar-passages/types'
import { licenceOfDocument } from './text-guard'

export const DOOR_QUOTE_FACTOR = 3

export const DOOR_QUOTE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

export const LICENSED_SNIPPET_NOTE =
  '[Licensed copy: its passage is not sent to an agent. Name the document, page and clause.]'

type Licence = NonNullable<Awaited<ReturnType<typeof licenceOfDocument>>>

async function guardedCopyForAgent(session: AuthorizedSession, documentId: string): Promise<Licence | null> {
  if (!actingReaderIsAgent()) return null
  await getAccessibleDocument(session, documentId)
  let licence: Awaited<ReturnType<typeof licenceOfDocument>>
  try {
    licence = await licenceOfDocument(session.organizationId, documentId)
  } catch {
    throw notSent('LICENSED_COPY_UNKNOWN', 'Whether this document is a licensed copy could not be read; try again.')
  }
  return licence?.licensed || licence?.held ? licence : null
}

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

export async function refuseLicensedFileForAgent(session: AuthorizedSession, documentId: string): Promise<void> {
  const copy = await guardedCopyForAgent(session, documentId)
  if (!copy) return
  if (copy.held) throw held()
  throw notSent(
    'LICENSED_COPY_NOT_SENT',
    'This is the office’s licensed copy of a standard: its file, versions and links are not sent to an agent. ' +
      'Search it with knowledge-search to find the place, and name the document, page and clause.'
  )
}

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
  const total = await incrementCounter(key, wanted.length, DOOR_QUOTE_WINDOW_MS)
  const text = total === null ? wanted : wanted.slice(0, Math.max(0, wanted.length - Math.max(0, total - budget)))
  if (wanted.length > 0 && text.length === 0) throw capReached(budget)
  return { ...preview, text, truncated: preview.truncated || text.length < preview.text.length }
}

export async function licensedCopiesForAgent(session: AuthorizedSession, documentIds: string[]): Promise<Set<string>> {
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

export async function searchForAgent(session: AuthorizedSession, response: SearchResponse): Promise<SearchResponse> {
  const section = response.sections.document
  if (!section || !actingReaderIsAgent()) return response
  const withPassage = section.hits.filter((hit) => hit.passage)
  const licensed = await licensedCopiesForAgent(session, withPassage.map((hit) => hit.id))
  if (licensed.size === 0) return response
  const hits = section.hits.map((hit) =>
    hit.passage && licensed.has(hit.id) ? { ...hit, passage: { ...hit.passage, text: LICENSED_SNIPPET_NOTE } } : hit
  )
  return { ...response, sections: { ...response.sections, document: { ...section, hits } } }
}

export async function similarForAgent(
  session: AuthorizedSession,
  response: SimilarPassagesResponse
): Promise<SimilarPassagesResponse> {
  if (!actingReaderIsAgent()) return response
  const ids = response.groups.flatMap((group) => group.documents.map((document) => document.documentId))
  const licensed = await licensedCopiesForAgent(session, ids)
  if (licensed.size === 0) return response
  return {
    ...response,
    groups: response.groups.map((group) => ({
      ...group,
      documents: group.documents.map((document) =>
        licensed.has(document.documentId)
          ? { ...document, passages: document.passages.map((passage) => ({ ...passage, snippet: LICENSED_SNIPPET_NOTE })) }
          : document
      ),
    })),
  }
}
