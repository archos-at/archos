import { sql } from 'drizzle-orm'
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import {
  INPUT_REQUEST_REASONS,
  INPUT_REQUEST_STATUSES,
  PERSON_DECIDED_STATUSES,
  type InputContent,
  type InputRequestReason,
  type InputRequestStatus,
  type RequestedSchema,
} from '@/lib/runs/input-request-types'
import { projects } from './projects'
import { taskRuns } from './task-model'

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

/**
 * `run_input_requests`: a run's question to a person, and the answer
 * (migration 0234, ADR-0181).
 *
 * `requested_schema` and `content` are the contract's shapes
 * (`lib/runs/input-request-types.ts`), parsed on every read. The CHECKs carry
 * the lifecycle: decided exactly when it left `open`, a deciding person exactly
 * on a person's decision, an answer exactly on `answered`.
 */
export const runInputRequests = pgTable(
  'run_input_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    /** The worker's own key for the question: one request per key and run. */
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason').$type<InputRequestReason>().notNull(),
    message: text('message').notNull(),
    requestedSchema: jsonb('requested_schema').$type<RequestedSchema>().notNull(),
    status: text('status').$type<InputRequestStatus>().notNull().default('open'),
    content: jsonb('content').$type<InputContent>(),
    /** The person who answered or declined; NULL when the run or the clock ended it. */
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectFk: foreignKey({
      name: 'run_input_requests_project_fk',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    runKeyUidx: uniqueIndex('uniq_run_input_requests_run_key').on(table.runId, table.idempotencyKey),
    // Created with `("run_id","created_at" DESC)` in the migration.
    runCreatedIdx: index('idx_run_input_requests_run_created').on(table.runId, table.createdAt),
    orgIdx: index('idx_run_input_requests_organization_id').on(table.organizationId),
    statusKnown: check('run_input_requests_status_known', sql`${table.status} IN (${list(INPUT_REQUEST_STATUSES)})`),
    reasonKnown: check('run_input_requests_reason_known', sql`${table.reason} IN (${list(INPUT_REQUEST_REASONS)})`),
    messageBounded: check('run_input_requests_message_bounded', sql`char_length(${table.message}) BETWEEN 1 AND 2000`),
    schemaIsObject: check('run_input_requests_schema_is_object', sql`jsonb_typeof(${table.requestedSchema}) = 'object'`),
    decidedWhenClosed: check(
      'run_input_requests_decided_when_closed',
      sql`(${table.status} <> 'open') = (${table.decidedAt} IS NOT NULL)`
    ),
    personDecides: check(
      'run_input_requests_person_decides',
      sql`(${table.status} IN (${list(PERSON_DECIDED_STATUSES)})) = (${table.decidedBy} IS NOT NULL)`
    ),
    contentWhenAnswered: check(
      'run_input_requests_content_when_answered',
      sql`(${table.status} = 'answered') = (${table.content} IS NOT NULL)`
    ),
    contentIsObject: check(
      'run_input_requests_content_is_object',
      sql`${table.content} IS NULL OR jsonb_typeof(${table.content}) = 'object'`
    ),
  })
)

export type RunInputRequest = typeof runInputRequests.$inferSelect
export type NewRunInputRequest = typeof runInputRequests.$inferInsert
