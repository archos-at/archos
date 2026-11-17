import { check, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { OfficeConventions } from '@/lib/office-conventions/extract'
import type { ConventionDecision, ConventionLine } from '@/lib/office-conventions/office-conventions-wire'

export const officeConventions = pgTable(
  'office_conventions',
  {
    organizationId: text('organization_id').primaryKey(),
    conventions: jsonb('conventions').$type<OfficeConventions>(),
    extractorVersion: integer('extractor_version'),
    sourceFingerprint: text('source_fingerprint'),
    computedAt: timestamp('computed_at', { withTimezone: true }),
    refreshRequestedAt: timestamp('refresh_requested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    computedTogether: check(
      'office_conventions_computed_together',
      sql`(${table.conventions} IS NULL) = (${table.computedAt} IS NULL) AND (${table.conventions} IS NULL) = (${table.sourceFingerprint} IS NULL) AND (${table.conventions} IS NULL) = (${table.extractorVersion} IS NULL)`
    ),
  })
)

export type OfficeConventionsRow = typeof officeConventions.$inferSelect

export const officeConventionDecisions = pgTable(
  'office_convention_decisions',
  {
    organizationId: text('organization_id').notNull(),
    lineKey: text('line_key').notNull(),
    decision: text('decision').$type<ConventionDecision>().notNull(),
    line: jsonb('line').$type<ConventionLine>().notNull(),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ name: 'office_convention_decisions_pkey', columns: [table.organizationId, table.lineKey] }),
    decisionKnown: check('office_convention_decisions_decision_known', sql`${table.decision} IN ('confirmed', 'declined')`),
    keyBounded: check('office_convention_decisions_key_bounded', sql`char_length(${table.lineKey}) BETWEEN 1 AND 300`),
    lineObject: check('office_convention_decisions_line_object', sql`jsonb_typeof(${table.line}) = 'object'`),
  })
)

export type OfficeConventionDecisionRow = typeof officeConventionDecisions.$inferSelect
