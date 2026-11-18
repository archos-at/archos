import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { EditionRole, PersonDecisionSource } from '@/lib/base-knowledge/wire/vocab'

export const messageEditionUses = pgTable('message_edition_uses', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull(),
  organizationId: text('organization_id').notNull(),
  projectId: uuid('project_id'),
  workId: text('work_id').notNull(),
  editionId: text('edition_id'),
  role: text('role').$type<EditionRole>().notNull(),
  qualifier: text('qualifier').$type<'uncurated' | 'office_maintained'>(),
  packSeqs: jsonb('pack_seqs').$type<Record<string, number>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectBaseConfirmations = pgTable('project_base_confirmations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  confirmedBy: text('confirmed_by').notNull(),
  decisionSource: text('decision_source').$type<PersonDecisionSource>().notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  packSeqs: jsonb('pack_seqs').$type<Record<string, number>>().notNull().default({}),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
})
