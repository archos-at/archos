import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const orgModelConfigs = pgTable('org_model_configs', {
  organizationId: text('organization_id').primaryKey(),
  activeVersionId: uuid('active_version_id').references(() => orgModelConfigVersions.id),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgModelConfigVersions = pgTable(
  'org_model_config_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    version: integer('version').notNull(),
    overrides: jsonb('overrides').notNull().default({}),
    modelSnapshot: jsonb('model_snapshot'),
    comment: text('comment'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgVersionUnique: uniqueIndex('uniq_org_model_config_versions_org_version').on(
      table.organizationId,
      table.version
    ),
    orgIdx: index('idx_org_model_config_versions_org').on(table.organizationId, table.createdAt),
  })
)

export type OrgModelConfig = typeof orgModelConfigs.$inferSelect
export type OrgModelConfigVersion = typeof orgModelConfigVersions.$inferSelect
export type NewOrgModelConfigVersion = typeof orgModelConfigVersions.$inferInsert
