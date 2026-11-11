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
import { normalizeContent } from '@/lib/knowledge/consolidation'
import { formatBoundedDigestWithKept } from '@/lib/knowledge/digest-format'
import { maskChatText } from '@/lib/upload-screening/service'
import {
  deletePersonalMemory,
  findPersonalMemoryByNormalizedContent,
  insertPersonalMemory,
  selectPersonalMemory,
  touchPersonalMemory,
  updatePersonalMemory,
  type PersonalMemoryOwner,
} from './repository'
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
}

/** A note's text as it may be stored and served: the office's screening applied (ADR-0086). */
async function masked(organizationId: string, content: string): Promise<string> {
  return (await maskChatText(organizationId, content)).text
}

/** One page of the person's notes, pinned first then newest (ADR-0131 rule 3: a list is a lean page). */
export async function listPersonalMemory(
  owner: PersonalMemoryOwner,
  page: OffsetPage = { limit: DEFAULT_PAGE_LIMIT, offset: 0 }
): Promise<PageOf<PersonalMemoryItem>> {
  const rows = await selectPersonalMemory(owner, page.limit + 1, page.offset)
  return { items: rows.slice(0, page.limit), nextCursor: nextOffsetCursor(page, rows.length) }
}

/**
 * Keep one note. A note that says what an existing one says (same text once
 * case and punctuation are folded) is that note, marked current again: the
 * agent restating a preference must not grow the list.
 */
export async function createPersonalMemoryItem(
  owner: PersonalMemoryOwner,
  note: NewPersonalNote
): Promise<{ item: PersonalMemoryItem; created: boolean }> {
  const content = await masked(owner.organizationId, note.content)
  const normalized = normalizeContent(content)
  const existing = await findPersonalMemoryByNormalizedContent(owner, normalized)
  if (existing) return { item: (await touchPersonalMemory(owner, existing.id)) ?? existing, created: false }
  try {
    const item = await insertPersonalMemory({
      organizationId: owner.organizationId,
      userId: owner.userId,
      kind: note.kind,
      content,
      provenanceType: note.provenanceType,
      pinned: note.pinned ?? false,
      sourceConversationId: note.sourceConversationId ?? null,
    })
    return { item, created: true }
  } catch (error) {
    // Two turns kept the same sentence at once: the unique index let one in.
    if (!isUniqueViolation(error)) throw error
    const winner = await findPersonalMemoryByNormalizedContent(owner, normalized)
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
  const next = patch.content === undefined ? patch : { ...patch, content: await masked(owner.organizationId, patch.content) }
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
