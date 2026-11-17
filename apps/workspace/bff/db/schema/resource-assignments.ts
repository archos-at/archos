import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { SHAREABLE_RESOURCE_TYPES, type ShareableResourceType } from './resource-shares'

export const resourceAssignments = pgTable(
  'resource_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    resourceType: text('resource_type').$type<ShareableResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),
    subjectUserId: text('subject_user_id').notNull(),
    assignedBy: text('assigned_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectUniq: uniqueIndex('uniq_resource_assignments_resource_subject').on(
      table.resourceType,
      table.resourceId,
      table.subjectUserId
    ),
    resourceIdx: index('idx_resource_assignments_resource').on(
      table.resourceType,
      table.resourceId
    ),
    orgSubjectIdx: index('idx_resource_assignments_org_subject').on(
      table.organizationId,
      table.subjectUserId,
      table.resourceType
    ),
  })
)

export type ResourceAssignment = typeof resourceAssignments.$inferSelect
export type NewResourceAssignment = typeof resourceAssignments.$inferInsert

export const ASSIGNMENT_RESOURCE_TYPES = SHAREABLE_RESOURCE_TYPES
