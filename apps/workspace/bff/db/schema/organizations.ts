import { char, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const organizations = pgTable('organizations', {
  workosOrganizationId: text('workos_organization_id').primaryKey(),
  displayName: text('display_name'),
  defaultLocale: text('default_locale'),
  homeCountry: char('home_country', { length: 2 }),
  timeZone: text('time_zone'),
  residencyCell: text('residency_cell'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert

export const PLATFORM_OWNED_SETTINGS = ['storageQuotaBytes', 'maxUploadFileBytes'] as const

export type PlatformOwnedSetting = (typeof PLATFORM_OWNED_SETTINGS)[number]

export const DEDICATED_ROUTE_SETTINGS = {
  zdrOnly:
    'zero data retention is switched through PUT /api/organization/model-config/zdr, which requires org:models:manage',
  uploadScreening:
    'upload screening is changed through PUT /api/organization/upload-screening, which validates the policy',
  downloadLogRetentionDays:
    'the download log retention is changed through PUT /api/organization/download-log/retention, which bounds it to 30-365 days and audits it',
  webSearchEnabled:
    'web search is switched through PUT /api/organization/web-search, which takes a boolean and audits it',
  deletedFolderContent:
    'what happens to content derived from deleted folders is changed through PUT /api/organization/deleted-folder-content, which validates the choice',
} as const
