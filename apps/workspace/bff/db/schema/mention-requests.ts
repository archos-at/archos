import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ShareableResourceType } from './resource-shares'

export const MENTION_REQUEST_STATUSES = ['open', 'answered', 'released', 'void'] as const
export type MentionRequestStatus = (typeof MENTION_REQUEST_STATUSES)[number]

export const MENTION_RESOLUTIONS = ['answered', 'asked_back', 'released', 'void'] as const
export type MentionResolution = (typeof MENTION_RESOLUTIONS)[number]

export const mentionRequests = pgTable(
  'mention_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    resourceType: text('resource_type').$type<ShareableResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),
    anchorId: text('anchor_id'),
    requestedBy: text('requested_by').notNull(),
    requestedOf: text('requested_of').notNull(),
    note: text('note'),
    status: text('status').$type<MentionRequestStatus>().notNull().default('open'),
    resolution: text('resolution').$type<MentionResolution>(),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    resourceStatusIdx: index('idx_mention_requests_resource_status').on(
      table.resourceType,
      table.resourceId,
      table.status
    ),
    requestedOfIdx: index('idx_mention_requests_requested_of_status').on(
      table.requestedOf,
      table.status
    ),
    orgRequestedByIdx: index('idx_mention_requests_org_requested_by').on(
      table.organizationId,
      table.requestedBy,
      table.status
    ),
  })
)

export type MentionRequest = typeof mentionRequests.$inferSelect
export type NewMentionRequest = typeof mentionRequests.$inferInsert
