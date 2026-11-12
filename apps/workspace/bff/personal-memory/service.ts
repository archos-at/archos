/**
 * Personal memory (ADR-0180): what the agent keeps about one person, read by
 * that person and nobody else.
 *
 * Self-scoped like `bff/user-preferences/service.ts`: every function takes the
 * owner from a session or a verified envelope, never from a request body.
 * Small on purpose. A person holds a few dozen notes, so a turn is given the
 * newest of them whole (pinned first) and there is no recall scoring, no
 * embedding and no status; when a person holds more notes than fit, the block
 * says how many it left out.
 */

import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import { DEFAULT_PAGE_LIMIT, nextOffsetCursor, type OffsetPage, type PageOf } from '@/lib/api/offset-page'
import { isUniqueViolation } from '@/lib/db/errors'
import type { PersonalMemoryItem } from '@/lib/db/schema/personal-memory'
import { formatBoundedDigestWithKept } from '@/lib/knowledge/digest-format'
import { assertStorableNote } from '@/lib/knowledge/note-content-guard'
import { maskChatText } from '@/lib/upload-screening/service'
import {
  deleteAllPersonalMemory,
  deletePersonalMemory,
  findPersonalMemoryByContentKey,
  insertPersonalMemory,
  selectPersonalMemory,
  touchPersonalMemory,
  updatePersonalMemory,
  type PersonalMemoryFilter,
  type PersonalMemoryOwner,
} from './repository'
import { personalContentKey, requirePersonalContentKey } from './content-key'
import type { PersonalMemoryKind, PersonalMemoryProvenance } from './vocabulary'

export type { PersonalMemoryOwner }

/** The header the agent's prompt names; the version moves when the line format does. */
export const PERSONAL_MEMORY_DIGEST_HEADER = 'PERSONAL_MEMORY v1'
/** The most notes one turn is given. */
export const PERSONAL_DIGEST_MAX_ITEMS = 20
/** The block's character budget, footer included. */
export const PERSONAL_DIGEST_MAX_CHARS = 1500

export interface NewPersonalNote {
  kind: PersonalMemoryKind
  content: string
  provenanceType: PersonalMemoryProvenance
  pinned?: boolean
  sourceConversationId?: string | null
  /** The answer the agent saved the note under (its message id); null for a note that belongs to none. */
  sourceMessageId?: string | null
}

/**
 * A note's text as it may be stored and served, with its key: the office's
 * screening applied (ADR-0086), then refused (400) when what is left holds a
 * secret (`note-content-guard.ts`; a person's own contact details may stay on
 * their own shelf) or no letter and no digit (`content-key.ts`).
 */
async function storable(organizationId: string, content: string): Promise<{ content: string; contentKey: string }> {
  const text = (await maskChatText(organizationId, content)).text
  assertStorableNote(text, { refuseContact: false })
  return { content: text, contentKey: requirePersonalContentKey(text) }
}

/**
 * One page of the person's notes, pinned first then newest (ADR-0131 rule 3: a
 * list is a lean page). `filter.sourceConversationId` keeps the notes saved
 * from one conversation, which is how an answer shows its owner what was kept
 * about them under it: the note is never stored on the message.
 */
export async function listPersonalMemory(
  owner: PersonalMemoryOwner,
  page: OffsetPage = { limit: DEFAULT_PAGE_LIMIT, offset: 0 },
  filter: PersonalMemoryFilter = {}
): Promise<PageOf<PersonalMemoryItem>> {
  const rows = await selectPersonalMemory(owner, page.limit + 1, page.offset, filter)
  return { items: rows.slice(0, page.limit), nextCursor: nextOffsetCursor(page, rows.length) }
}

/**
 * Keep one note. A note that says what an existing one says (the same
 * `content_key`: case and punctuation folded, letters of every script kept) is
 * that note, marked current again, and answers `created: false`: the agent
 * restating a preference must not grow the list.
 */
export async function createPersonalMemoryItem(
  owner: PersonalMemoryOwner,
  note: NewPersonalNote
): Promise<{ item: PersonalMemoryItem; created: boolean }> {
  const { content, contentKey } = await storable(owner.organizationId, note.content)
  const existing = await findPersonalMemoryByContentKey(owner, contentKey)
  if (existing) return { item: (await touchPersonalMemory(owner, existing.id)) ?? existing, created: false }
  try {
    const item = await insertPersonalMemory({
      organizationId: owner.organizationId,
      userId: owner.userId,
      kind: note.kind,
      content,
      contentKey,
      provenanceType: note.provenanceType,
      pinned: note.pinned ?? false,
      sourceConversationId: note.sourceConversationId ?? null,
      sourceMessageId: note.sourceMessageId ?? null,
    })
    return { item, created: true }
  } catch (error) {
    // Two turns kept the same sentence at once: the unique index let one in.
    if (!isUniqueViolation(error)) throw error
    const winner = await findPersonalMemoryByContentKey(owner, contentKey)
    if (!winner) throw error
    return { item: winner, created: false }
  }
}

/** Change a note. A text another note of the person already says is a 409, not a second copy. */
export async function editPersonalMemoryItem(
  owner: PersonalMemoryOwner,
  id: string,
  patch: { kind?: PersonalMemoryKind; content?: string; pinned?: boolean }
): Promise<PersonalMemoryItem | null> {
  const next = patch.content === undefined ? patch : { ...patch, ...(await storable(owner.organizationId, patch.content)) }
  try {
    return await updatePersonalMemory(owner, id, next)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('Another personal note already says this')
    throw error
  }
}

export async function removePersonalMemoryItem(owner: PersonalMemoryOwner, id: string): Promise<boolean> {
  return deletePersonalMemory(owner, id)
}

/**
 * What the agent's forget did: the note it removed, `curated` when the quoted
 * note is one the person wrote or pinned, `not_found` when no note says that.
 */
export type ForgetPersonalNoteOutcome =
  | { removedId: string; refused: null }
  | { removedId: null; refused: 'curated' | 'not_found' }

/**
 * The agent's undo: remove the person's note that says `quoted`, the text it
 * was shown in its `PERSONAL_MEMORY` block. Matched by `content_key` only, so
 * case and punctuation do not matter and nothing is guessed at: an unmatched
 * quote removes nothing and says so. A note the person wrote or pinned is
 * theirs to remove in the panel, never the agent's (design §3.2, as for
 * project memory).
 */
export async function forgetPersonalMemoryItem(
  owner: PersonalMemoryOwner,
  quoted: string
): Promise<ForgetPersonalNoteOutcome> {
  const key = personalContentKey(quoted)
  const note = key ? await findPersonalMemoryByContentKey(owner, key) : null
  if (!note) return { removedId: null, refused: 'not_found' }
  if (note.pinned || note.provenanceType === 'user') return { removedId: null, refused: 'curated' }
  if (!(await deletePersonalMemory(owner, note.id))) return { removedId: null, refused: 'not_found' }
  return { removedId: note.id, refused: null }
}

/**
 * Remove every note of the person in this organization, for good; answers how
 * many went. The person's own „clear my memory“ (`DELETE /api/user/memory`),
 * and what a member-removal or account-erasure path must call once the product
 * has one (ADR-0180, „Erasure of a person's notes“).
 */
export async function clearPersonalMemory(owner: PersonalMemoryOwner): Promise<number> {
  return deleteAllPersonalMemory(owner)
}

/**
 * The block a turn of this person starts from, or null when they hold no note.
 *
 * One line per note, `- [kind] "content"`, quoted and escaped by the shared
 * formatter so a note's text cannot forge a line. Bounded twice (items, then
 * characters), and a cut is said in the block itself, in English because the
 * agent reads it. The formatter stops at the first note that does not fit, so
 * a long note ahead of short ones cuts those too; the footer counts them all.
 */
export async function buildPersonalMemoryDigest(owner: PersonalMemoryOwner): Promise<string | null> {
  const rows = await selectPersonalMemory(owner, PERSONAL_DIGEST_MAX_ITEMS + 1)
  if (rows.length === 0) return null
  const candidates = rows.slice(0, PERSONAL_DIGEST_MAX_ITEMS).map((row) => ({
    tags: row.pinned ? ['pinned', row.kind] : [row.kind],
    content: row.content,
  }))
  const footer = (omitted: number) => `(+${omitted} more personal notes, not shown.)`
  // Reserve the footer's room up front, so adding it never breaks the budget.
  const reserve = footer(rows.length).length + 1
  const { digest, kept } = formatBoundedDigestWithKept(
    PERSONAL_MEMORY_DIGEST_HEADER,
    candidates,
    PERSONAL_DIGEST_MAX_CHARS - reserve
  )
  const omitted = rows.length - kept.length
  // Not even the first note fits (one note may hold 2,000 characters): the
  // block still says the person holds notes, instead of reading as "none".
  if (!digest) return `${PERSONAL_MEMORY_DIGEST_HEADER}\n${footer(omitted)}`
  return omitted > 0 ? `${digest}\n${footer(omitted)}` : digest
}
