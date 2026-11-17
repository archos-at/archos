/**
 * Golden cases as platform records, and the runs that score them (migration
 * 0228, ADR-0165 amendment): a case's body, one run of a country's cases, and
 * one case of a run with its verdict.
 *
 * All three are platform-private. The body is append-only like every revision
 * body; the SQL holds the invariants (a case is asked before it is settled, a
 * settled case has a verdict or a failure, one case per conversation).
 */

import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { GoldenCaseContext, GoldenCaseExpected, GoldenCaseMustNot, GoldenCaseResult } from '@/lib/base-knowledge/wire/golden-case'

export const knowledgeGoldenCaseRevisions = pgTable('knowledge_golden_case_revisions', {
  revisionId: uuid('revision_id').primaryKey(),
  recordId: text('record_id').notNull(),
  organizationId: text('organization_id'),
  question: text('question').notNull(),
  language: text('language').notNull(),
  context: jsonb('context').$type<GoldenCaseContext>().notNull(),
  expected: jsonb('expected').$type<GoldenCaseExpected>().notNull(),
  mustNot: jsonb('must_not').$type<GoldenCaseMustNot[]>().notNull(),
  tags: text('tags').array().notNull(),
})

export const knowledgeGoldenRuns = pgTable('knowledge_golden_runs', {
  id: uuid('id').primaryKey(),
  countryId: text('country_id').notNull(),
  changeRequestId: uuid('change_request_id'),
  askedIn: text('asked_in').notNull(),
  startedBy: text('started_by').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  releaseSeq: bigint('release_seq', { mode: 'number' }),
})

export const knowledgeGoldenRunCases = pgTable(
  'knowledge_golden_run_cases',
  {
    runId: uuid('run_id').notNull(),
    recordId: text('record_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    position: integer('position').notNull(),
    askId: uuid('ask_id'),
    conversationId: text('conversation_id'),
    askedAt: timestamp('asked_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    passed: boolean('passed'),
    result: jsonb('result').$type<GoldenCaseResult>(),
    failure: text('failure'),
  },
  (table) => [primaryKey({ columns: [table.runId, table.recordId] })],
)
