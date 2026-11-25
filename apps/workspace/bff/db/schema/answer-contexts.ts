import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const answerContexts = pgTable(
  'answer_contexts',
  {
    organizationId: text('organization_id').notNull(),
    messageId: text('message_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    audienceVersion: integer('audience_version'),
    solo: boolean('solo').notNull(),
    projectId: uuid('project_id'),
    shelves: text('shelves').array().notNull().default(sql`'{}'::text[]`),
    otherProjects: text('other_projects').notNull(),
    workspaceRead: text('workspace_read').notNull(),
    personalMemory: boolean('personal_memory').notNull(),
    personalShelf: boolean('personal_shelf').notNull(),
    readFolders: text('read_folders').array().notNull().default(sql`'{}'::text[]`),
    readProjects: text('read_projects').array().notNull().default(sql`'{}'::text[]`),
    readPersonalShelf: boolean('read_personal_shelf').notNull().default(false),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ name: 'answer_contexts_pk', columns: [table.organizationId, table.messageId] }),
    conversationIdx: index('answer_contexts_conversation_idx').on(table.organizationId, table.conversationId),
    kind: check('answer_contexts_kind', sql`${table.kind} IN ('chat', 'run', 'headless', 'external')`),
    otherProjects: check(
      'answer_contexts_other_projects',
      sql`${table.otherProjects} IN ('none', 'every-reader', 'chat-projects')`,
    ),
    workspaceRead: check(
      'answer_contexts_workspace_read',
      sql`${table.workspaceRead} IN ('none', 'document+projectFacts', 'all')`,
    ),
    version: check('answer_contexts_version', sql`${table.audienceVersion} IS NULL OR ${table.audienceVersion} >= 0`),
  })
)

export type AnswerContext = typeof answerContexts.$inferSelect
