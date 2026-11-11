import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { PersonalMemoryKind, PersonalMemoryProvenance } from '@/lib/personal-memory/vocabulary'

/**
 * Personal memory (ADR-0180, migrations 0225 and 0227): what the agent keeps about one
 * person. Row-level security names the person
 * (`organization_id = current_org() AND user_id = current_user_id()`), so a
 * colleague's or an administrator's query matches no row. The unique index on
 * the normalized content lives in the migration; drizzle cannot express it.
 */
export const personalMemory = pgTable(
  'personal_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text('kind').$type<PersonalMemoryKind>().notNull(),
    content: text('content').notNull(),
    provenanceType: text('provenance_type').$type<PersonalMemoryProvenance>().notNull().default('agent'),
    sourceConversationId: text('source_conversation_id'),
    /** The answer the note was saved under (migration 0227): the answer message's id; null for a note that belongs to none. */
    sourceMessageId: uuid('source_message_id'),
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
  })
)

export type PersonalMemoryItem = typeof personalMemory.$inferSelect
export type NewPersonalMemoryItem = typeof personalMemory.$inferInsert
