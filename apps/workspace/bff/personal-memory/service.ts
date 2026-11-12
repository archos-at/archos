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
import {
  DEFAULT_PAGE_LIMIT,
  nextOffsetCursor,
  type OffsetPage,
  type PageOf,
} from '@/lib/api/offset-page'
import { isUniqueViolation } from '@/lib/db/errors'
import type { PersonalMemoryItem } from '@/lib/db/schema/personal-memory'
import { assertStorableNote } from '@/lib/knowledge/note-content-guard'
import { maskChatText } from '@/lib/upload-screening/service'
import {
  requireRenameFrom,
  resolveTopic,
  summarizeTopics,
  type MemoryTopicCount,
} from '@/lib/memory-topics/topic'
import {
  deleteAllPersonalMemory,
  deletePersonalMemory,
  deletePersonalTopic,
  findPersonalMemoryByContentKey,
  insertPersonalMemory,
  movePersonalTopic,
  selectPersonalMemory,
  selectPersonalTopics,
  touchPersonalMemory,
  updatePersonalMemory,
  type PersonalMemoryFilter,
  type PersonalMemoryOwner,
} from './repository'
import { personalContentKey, requirePersonalContentKey } from './content-key'
import { PERSONAL_DIGEST_MAX_ITEMS, renderPersonalMemoryDigest } from './digest'
import type { PersonalMemoryKind, PersonalMemoryProvenance } from './vocabulary'

export type { PersonalMemoryOwner }
export {
  PERSONAL_DIGEST_MAX_CHARS,
  PERSONAL_DIGEST_MAX_ITEMS,
  PERSONAL_MEMORY_DIGEST_HEADER,
} from './digest'

export interface NewPersonalNote {
  kind: PersonalMemoryKind
  content: string
  provenanceType: PersonalMemoryProvenance
  pinned?: boolean
  sourceConversationId?: string | null
  /** The answer the agent saved the note under (its message id); null: none. */
  sourceMessageId?: string | null
  /**
   * The note's topic, as the person or the agent named it; resolved against
   * the person's topics on write.
   */
  topic?: string | null
}

/** The names of the person's topics, for `resolveTopic`: every note's topic, each name once. */
async function ownerTopicNames(owner: PersonalMemoryOwner): Promise<string[]> {
  const rows = await selectPersonalTopics(owner)
  return [...new Set(rows.flatMap((row) => (row.topic === null ? [] : [row.topic])))]
}

/**
 * A note's text as it may be stored and served, with its key: the office's
 * screening applied (ADR-0086), then refused (400) when what is left holds a
 * secret (`note-content-guard.ts`; a person's own contact details may stay on
 * their own shelf) or no letter and no digit (`content-key.ts`).
 */
async function storable(
  organizationId: string,
  content: string
): Promise<{ content: string; contentKey: string }> {
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
 * A list's filter as its query states it: the conversation, and the topic
 * resolved against the person's topics. `topic: ''` is the notes with no topic.
 */
export async function personalListFilter(
  owner: PersonalMemoryOwner,
  query: { sourceConversationId?: string; topic?: string }
): Promise<PersonalMemoryFilter> {
  const topic =
    query.topic === undefined ? undefined : resolveTopic(query.topic, await ownerTopicNames(owner))
  return {
    sourceConversationId: query.sourceConversationId,
    ...(topic === undefined ? {} : { topic }),
  }
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
  if (existing) {
    return { item: (await touchPersonalMemory(owner, existing.id)) ?? existing, created: false }
  }
  const topic =
    note.topic === undefined ? null : resolveTopic(note.topic, await ownerTopicNames(owner))
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
      topic,
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
  patch: { kind?: PersonalMemoryKind; content?: string; pinned?: boolean; topic?: string | null }
): Promise<PersonalMemoryItem | null> {
  const { topic: rawTopic, ...rest } = patch
  const topic =
    rawTopic === undefined ? {} : { topic: resolveTopic(rawTopic, await ownerTopicNames(owner)) }
  const content =
    rest.content === undefined ? {} : await storable(owner.organizationId, rest.content)
  const next = { ...rest, ...content, ...topic }
  try {
    return await updatePersonalMemory(owner, id, next)
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('Another personal note already says this')
    throw error
  }
}

export async function removePersonalMemoryItem(
  owner: PersonalMemoryOwner,
  id: string
): Promise<boolean> {
  return deletePersonalMemory(owner, id)
}

/** The person's topics and how many of their notes each holds, the order the topics list shows. */
export async function listPersonalMemoryTopics(
  owner: PersonalMemoryOwner
): Promise<MemoryTopicCount[]> {
  return summarizeTopics(await selectPersonalTopics(owner))
}

/**
 * Move every note of the person on topic `from` to topic `to` (`PATCH …/memory/topics`).
 * `to` is resolved against the person's other topics, so a name another topic
 * has (any case) merges into it, and a new name renames. `to` null ungroups.
 * A rename that lands on its own name writes nothing. Answers how many notes moved.
 */
export async function renamePersonalMemoryTopic(
  owner: PersonalMemoryOwner,
  input: { from: string | null; to: string | null }
): Promise<{ moved: number }> {
  requireRenameFrom(input.from)
  const names = await ownerTopicNames(owner)
  const from = resolveTopic(input.from, names)
  const to = resolveTopic(input.to, names.filter((name) => name !== from))
  if (to === from) return { moved: 0 }
  return { moved: await movePersonalTopic(owner, from, to) }
}

/**
 * Remove every note of the person on topic `name`, for good (`DELETE …/memory/topics`).
 * Only the caller's notes: the row-level security holds the same line. Answers how many went.
 */
export async function removePersonalMemoryTopic(
  owner: PersonalMemoryOwner,
  name: string
): Promise<{ removed: number }> {
  const topic = resolveTopic(name, await ownerTopicNames(owner))
  if (topic === null) return { removed: 0 }
  return { removed: await deletePersonalTopic(owner, topic) }
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
  if (!(await deletePersonalMemory(owner, note.id))) {
    return { removedId: null, refused: 'not_found' }
  }
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
 * The notes the block shows are the newest twenty, pinned first; the topic index
 * and the footer count the whole shelf (`renderPersonalMemoryDigest`, in
 * `digest.ts`, says how the block is laid out). The shelf's topics are read from
 * every note of the person, so the index matches the topics list on the screen.
 */
export async function buildPersonalMemoryDigest(
  owner: PersonalMemoryOwner
): Promise<string | null> {
  const [rows, topicRows] = await Promise.all([
    selectPersonalMemory(owner, PERSONAL_DIGEST_MAX_ITEMS + 1),
    selectPersonalTopics(owner),
  ])
  if (rows.length === 0) return null
  return renderPersonalMemoryDigest(rows.slice(0, PERSONAL_DIGEST_MAX_ITEMS), {
    topics: summarizeTopics(topicRows),
    total: Math.max(topicRows.length, rows.length),
  })
}
