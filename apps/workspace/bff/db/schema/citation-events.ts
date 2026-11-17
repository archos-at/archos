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

export const CITATION_EVENT_KINDS = [
  'turn_verified',
  'citations_removed',
  'quote_unverified',
  'answer_ungrounded',
  'registry_empty',
  'citation_fallback',
  'confidence_capped',
  'retrieval_precision',
] as const
export type CitationEventKind = (typeof CITATION_EVENT_KINDS)[number]

export const CITATION_EVENT_SEVERITIES = ['ok', 'info', 'warn', 'error'] as const
export type CitationEventSeverity = (typeof CITATION_EVENT_SEVERITIES)[number]

export const CITATION_EVENT_AGENTS = ['shallow', 'deep'] as const
export type CitationEventAgent = (typeof CITATION_EVENT_AGENTS)[number]

export const CITATION_BASELINE_KIND: CitationEventKind = 'turn_verified'

export const CITATION_PRECISION_KIND: CitationEventKind = 'retrieval_precision'

export const citationEvents = pgTable(
  'citation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id'),
    conversationId: text('conversation_id'),
    turnId: text('turn_id').notNull(),
    jobId: text('job_id'),
    agent: text('agent').$type<CitationEventAgent>().notNull(),
    kind: text('kind').$type<CitationEventKind>().notNull(),
    severity: text('severity').$type<CitationEventSeverity>().notNull(),
    count: integer('count').notNull().default(1),
    reasons: jsonb('reasons').$type<Record<string, number> | null>(),
    detail: jsonb('detail').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    turnKindUidx: uniqueIndex('citation_events_turn_kind_uidx').on(table.turnId, table.kind),
    createdKindIdx: index('citation_events_created_kind_idx').on(table.createdAt, table.kind),
    orgCreatedIdx: index('citation_events_org_created_idx').on(
      table.organizationId,
      table.createdAt
    ),
    conversationCreatedIdx: index('citation_events_conversation_created_idx').on(
      table.conversationId,
      table.createdAt
    ),
  })
)

export type CitationEvent = typeof citationEvents.$inferSelect
export type NewCitationEvent = typeof citationEvents.$inferInsert
