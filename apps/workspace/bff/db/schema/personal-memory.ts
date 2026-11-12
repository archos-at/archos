import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { PersonalMemoryKind, PersonalMemoryProvenance } from '@/lib/personal-memory/vocabulary'

/**
 * Personal memory (ADR-0180, migrations 0229, 0231, 0232 and 0237): what the agent keeps about one
 * person. Row-level security names the person
 * (`organization_id = current_org() AND user_id = current_user_id()`), so a
 * colleague's or an administrator's query matches no row. A note is unique per
 * person by `content_key`, which `personalContentKey` computes and nothing else.
 */
export const personalMemory = pgTable(
  'personal_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text('kind').$type<PersonalMemoryKind>().notNull(),
    content: text('content').notNull(),
    /** What makes two notes one (migration 0232): `personalContentKey(content)`, written with every content. */
    contentKey: text('content_key').notNull(),
    provenanceType: text('provenance_type').$type<PersonalMemoryProvenance>().notNull().default('agent'),
    sourceConversationId: text('source_conversation_id'),
    /** The answer the note was saved under (migration 0231): the answer message's id; null for a note that belongs to none. */
    sourceMessageId: uuid('source_message_id'),
    /** What the note is about (migration 0237): a short subject, reused across the person's notes; null is "no topic". */
    topic: text('topic'),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index('idx_personal_memory_owner').on(
      table.organizationId,
      table.userId,
      table.pinned,
      table.updatedAt
    ),
    ownerContentKeyUnique: uniqueIndex('uniq_personal_memory_owner_content_key').on(
      table.organizationId,
      table.userId,
      table.contentKey
    ),
    ownerTopicIdx: index('idx_personal_memory_topic').on(table.organizationId, table.userId, table.topic),
  })
)

export type PersonalMemoryItem = typeof personalMemory.$inferSelect
export type NewPersonalMemoryItem = typeof personalMemory.$inferInsert
