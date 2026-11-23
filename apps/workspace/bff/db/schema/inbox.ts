import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { SHAREABLE_RESOURCE_TYPES } from './resource-shares'

import { INBOX_ITEM_TYPES, type InboxItemType } from '@/lib/inbox/inbox-vocabulary'
import type { StoredInboxType } from '@/lib/inbox/legacy-agent-types'
export { INBOX_ITEM_TYPES, type InboxItemType }

export const INBOX_TARGET_TYPES = [
  ...SHAREABLE_RESOURCE_TYPES,
  'organization',
  'project',
  'product_feedback',
  'upload_batch',
] as const
export type InboxTargetType = (typeof INBOX_TARGET_TYPES)[number]

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    recipientUserId: text('recipient_user_id').notNull(),
    type: text('type').$type<StoredInboxType>().notNull(),
    resourceType: text('resource_type').$type<InboxTargetType>().notNull(),
    resourceId: text('resource_id').notNull(),
    anchorId: text('anchor_id'),
    actorUserId: text('actor_user_id'),
    groupKey: text('group_key').notNull(),
    actionable: boolean('actionable').notNull(),
    count: integer('count').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    inertAt: timestamp('inert_at', { withTimezone: true }),
  },
  (table) => ({
    groupUniq: uniqueIndex('uniq_inbox_items_recipient_group').on(
      table.recipientUserId,
      table.groupKey
    ),
    listIdx: index('idx_inbox_items_recipient_org_updated').on(
      table.recipientUserId,
      table.organizationId,
      table.updatedAt
    ),
    targetIdx: index('idx_inbox_items_target').on(table.resourceType, table.resourceId),
    createdIdx: index('idx_inbox_items_created_at').on(table.createdAt),
  })
)

export type InboxItem = typeof inboxItems.$inferSelect
export type NewInboxItem = typeof inboxItems.$inferInsert
