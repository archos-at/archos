import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const SPAN_KINDS = ['turn', 'node', 'llm', 'tool'] as const
export type SpanKind = (typeof SPAN_KINDS)[number]

export const SPAN_STATUSES = ['ok', 'error'] as const
export type SpanStatus = (typeof SPAN_STATUSES)[number]

export const agentProfilerSpans = pgTable(
  'agent_profiler_spans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id'),
    conversationId: text('conversation_id'),
    turnId: text('turn_id').notNull(),
    jobId: text('job_id'),
    spanId: text('span_id').notNull(),
    parentSpanId: text('parent_span_id'),
    kind: text('kind').$type<SpanKind>().notNull(),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    status: text('status').$type<SpanStatus>().notNull().default('ok'),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index('agent_profiler_spans_org_created_idx').on(
      table.organizationId,
      table.createdAt
    ),
    conversationTurnIdx: index('agent_profiler_spans_conversation_turn_idx').on(
      table.conversationId,
      table.turnId
    ),
    conversationStartedIdx: index('agent_profiler_spans_conversation_started_idx').on(
      table.conversationId,
      table.startedAt
    ),
  })
)

export type AgentProfilerSpan = typeof agentProfilerSpans.$inferSelect
export type NewAgentProfilerSpan = typeof agentProfilerSpans.$inferInsert
