import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import type { ResourceRole, ShareableResourceType } from '@/lib/sharing/sharing-vocabulary'

export {
  RESOURCE_ROLES,
  RESOURCE_VISIBILITIES,
  SHAREABLE_RESOURCE_TYPES,
  type ResourceRole,
  type ResourceVisibility,
  type ShareableResourceType,
} from '@/lib/sharing/sharing-vocabulary'

export const resourceShares = pgTable(
  'resource_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    resourceType: text('resource_type').$type<ShareableResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),
    subjectUserId: text('subject_user_id').notNull(),
    role: text('role').$type<ResourceRole>().notNull(),
    grantedBy: text('granted_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectUniq: uniqueIndex('uniq_resource_shares_resource_subject').on(
      table.resourceType,
      table.resourceId,
      table.subjectUserId
    ),
    subjectIdx: index('idx_resource_shares_org_subject').on(
      table.organizationId,
      table.subjectUserId,
      table.resourceType
    ),
    resourceIdx: index('idx_resource_shares_resource').on(table.resourceType, table.resourceId),
  })
)

export type ResourceShare = typeof resourceShares.$inferSelect
export type NewResourceShare = typeof resourceShares.$inferInsert
