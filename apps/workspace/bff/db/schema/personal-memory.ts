import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { PersonalMemoryKind, PersonalMemoryProvenance } from '@/lib/personal-memory/vocabulary'

export const personalMemory = pgTable(
  'personal_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text('kind').$type<PersonalMemoryKind>().notNull(),
    content: text('content').notNull(),
    contentKey: text('content_key').notNull(),
    provenanceType: text('provenance_type').$type<PersonalMemoryProvenance>().notNull().default('agent'),
    sourceConversationId: text('source_conversation_id'),
    sourceMessageId: uuid('source_message_id'),
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
