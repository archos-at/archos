/**
 * Personal memory API client
 *
 * Typed fetch client for the caller's own notes (`/api/user/memory…`,
 * ADR-0180): what the agent keeps about the person, read by that person and
 * nobody else. Same-origin BFF routes. The vocabulary comes from
 * `bff/personal-memory/vocabulary.ts`, which imports no schema, so nothing of
 * the database reaches the browser bundle.
 *
 * A non-OK answer throws {@link ApiRequestError} carrying the HTTP status and
 * the refusal's `details`. A caller reads two: 409 on an edit (another note of
 * the person already says the same), and a 400 whose `details.kind` names
 * what a note may not hold (`noteRefusalKind`, `bff/knowledge/note-refusal.ts`).
 */

import type { PersonalMemoryKind, PersonalMemoryProvenance } from '@/lib/personal-memory/vocabulary'
import { ApiRequestError } from './api-error'

/** A note as the routes send it (timestamps are ISO strings over the wire). */
export interface PersonalMemoryNote {
  id: string
  kind: PersonalMemoryKind
  content: string
  provenanceType: PersonalMemoryProvenance
  pinned: boolean
  sourceConversationId: string | null
  createdAt: string
  updatedAt: string
}

/** One page of the person's notes, pinned first, then newest. */
export interface PersonalMemoryPage {
  items: PersonalMemoryNote[]
  nextCursor: string | null
}

export interface PersonalMemoryCreate {
  kind: PersonalMemoryKind
  content: string
  pinned?: boolean
}

/** What a note may be changed to; at least one field. */
export interface PersonalMemoryUpdate {
  kind?: PersonalMemoryKind
  content?: string
  pinned?: boolean
}

const MEMORY_PATH = '/api/user/memory'
const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }
const notePath = (itemId: string): string => `${MEMORY_PATH}/${encodeURIComponent(itemId)}`

/** The refusal as an error: its status, `details.reason` and `details` (a refused note's `kind`). */
async function refusal(response: Response, what: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const details = (body as { details?: unknown } | null)?.details
  const record = details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : null
  const reason = typeof record?.reason === 'string' ? record.reason : null
  return new ApiRequestError(`Failed to ${what} personal memory: ${response.status}`, response.status, reason, record)
}

/** One page of the notes, `limit` at a time, from `cursor` on. */
export const listPersonalMemory = async (
  options: { limit?: number; cursor?: string | null } = {},
): Promise<PersonalMemoryPage> => {
  const query = new URLSearchParams()
  if (options.limit) query.set('limit', String(options.limit))
  if (options.cursor) query.set('cursor', options.cursor)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  const response = await fetch(`${MEMORY_PATH}${suffix}`)
  if (!response.ok) throw new ApiRequestError(`Failed to list personal memory: ${response.status}`, response.status)
  return (await response.json()) as PersonalMemoryPage
}

/**
 * Keep a note the person wrote. Answers the note and whether it is new: a
 * text an existing note already says answers THAT note, marked current again,
 * with `created: false`, not a second copy.
 */
export const addPersonalMemoryNote = async (
  input: PersonalMemoryCreate,
): Promise<{ item: PersonalMemoryNote; created: boolean }> => {
  const response = await fetch(MEMORY_PATH, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })
  if (!response.ok) throw await refusal(response, 'add')
  return (await response.json()) as { item: PersonalMemoryNote; created: boolean }
}

/** Change a note. 409 when another note already says the new text. */
export const updatePersonalMemoryNote = async (
  itemId: string,
  update: PersonalMemoryUpdate,
): Promise<{ item: PersonalMemoryNote }> => {
  const response = await fetch(notePath(itemId), { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(update) })
  if (!response.ok) throw await refusal(response, 'update')
  return (await response.json()) as { item: PersonalMemoryNote }
}

/** Remove every note of the person for good. Answers how many went. */
export const clearPersonalMemory = async (): Promise<{ removed: number }> => {
  const response = await fetch(MEMORY_PATH, { method: 'DELETE' })
  if (!response.ok) throw new ApiRequestError(`Failed to clear personal memory: ${response.status}`, response.status)
  return (await response.json()) as { removed: number }
}

/** Remove a note for good. */
export const removePersonalMemoryNote = async (itemId: string): Promise<void> => {
  const response = await fetch(notePath(itemId), { method: 'DELETE' })
  if (!response.ok) throw new ApiRequestError(`Failed to remove personal memory: ${response.status}`, response.status)
}
