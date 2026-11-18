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
  distinctTopicNames,
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
  sourceMessageId?: string | null
  topic?: string | null
}

async function ownerTopicNames(owner: PersonalMemoryOwner): Promise<string[]> {
  return distinctTopicNames(await selectPersonalTopics(owner))
}

async function storable(
  organizationId: string,
  content: string
): Promise<{ content: string; contentKey: string }> {
  const text = (await maskChatText(organizationId, content)).text
  assertStorableNote(text, { refuseContact: false })
  return { content: text, contentKey: requirePersonalContentKey(text) }
}

export async function listPersonalMemory(
  owner: PersonalMemoryOwner,
  page: OffsetPage = { limit: DEFAULT_PAGE_LIMIT, offset: 0 },
  filter: PersonalMemoryFilter = {}
): Promise<PageOf<PersonalMemoryItem>> {
  const rows = await selectPersonalMemory(owner, page.limit + 1, page.offset, filter)
  return { items: rows.slice(0, page.limit), nextCursor: nextOffsetCursor(page, rows.length) }
}

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

export async function createPersonalMemoryItem(
  owner: PersonalMemoryOwner,
  note: NewPersonalNote
): Promise<{ item: PersonalMemoryItem; created: boolean }> {
  const { content, contentKey } = await storable(owner.organizationId, note.content)
  const existing = await findPersonalMemoryByContentKey(owner, contentKey)
  if (existing) {
    const topic = note.topic ? resolveTopic(note.topic, await ownerTopicNames(owner)) : null
    const item = await touchPersonalMemory(owner, existing.id, topic)
    return { item: item ?? existing, created: false }
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
    if (!isUniqueViolation(error)) throw error
    const winner = await findPersonalMemoryByContentKey(owner, contentKey)
    if (!winner) throw error
    return { item: winner, created: false }
  }
}

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

export async function listPersonalMemoryTopics(
  owner: PersonalMemoryOwner
): Promise<MemoryTopicCount[]> {
  return summarizeTopics(await selectPersonalTopics(owner))
}

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

export async function removePersonalMemoryTopic(
  owner: PersonalMemoryOwner,
  name: string
): Promise<{ removed: number }> {
  const topic = resolveTopic(name, await ownerTopicNames(owner))
  if (topic === null) return { removed: 0 }
  return { removed: await deletePersonalTopic(owner, topic) }
}

export type ForgetPersonalNoteOutcome =
  | { removedId: string; refused: null }
  | { removedId: null; refused: 'curated' | 'not_found' }

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

export async function clearPersonalMemory(owner: PersonalMemoryOwner): Promise<number> {
  return deleteAllPersonalMemory(owner)
}

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
