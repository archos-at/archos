import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { taskDefinitions } from './task-model'
import { projects } from './projects'
import { type ResourceVisibility, type ShareableResourceType } from './resource-shares'

export const CONVERSATION_ENGAGEMENTS = ['ask', 'mention'] as const
export type ConversationEngagement = (typeof CONVERSATION_ENGAGEMENTS)[number]

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    createdBy: text('created_by').notNull(),
    title: text('title'),
    visibility: text('visibility').$type<ResourceVisibility>().notNull().default('private'),
    engagement: text('engagement').$type<ConversationEngagement>(),
    tags: text('tags').array().notNull().default([]),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => taskDefinitions.id, { onDelete: 'set null' }),
    subjectResourceType: text('subject_resource_type').$type<ShareableResourceType>(),
    subjectResourceId: text('subject_resource_id'),
    temporary: boolean('temporary').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgUpdatedIdx: index('conversations_org_updated_idx').on(table.organizationId, table.updatedAt),
    projectIdx: index('conversations_project_idx').on(table.projectId),
    tagsIdx: index('conversations_tags_idx').using('gin', table.tags),
    idOrganizationKey: unique('conversations_id_organization_id_key').on(
      table.id,
      table.organizationId
    ),
  })
)

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
