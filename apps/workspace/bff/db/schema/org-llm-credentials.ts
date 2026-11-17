import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const orgLlmCredentials = pgTable(
  'org_llm_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    provider: text('provider').notNull(),
    label: text('label').notNull(),
    baseUrl: text('base_url'),
    secretBackend: text('secret_backend').notNull(),
    vaultObjectId: text('vault_object_id'),
    encryptedKey: text('encrypted_key'),
    keyFingerprint: text('key_fingerprint').notNull(),
    keyHint: text('key_hint').notNull(),
    status: text('status').notNull().default('active'),
    rotatedFrom: uuid('rotated_from'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
  },
  (table) => ({
    activePerOrgUnique: uniqueIndex('uniq_org_llm_credentials_active')
      .on(table.organizationId)
      .where(sql`${table.status} = 'active'`),
    orgIdx: index('idx_org_llm_credentials_org').on(table.organizationId, table.createdAt),
  })
)

export type OrgLlmCredential = typeof orgLlmCredentials.$inferSelect
export type NewOrgLlmCredential = typeof orgLlmCredentials.$inferInsert
