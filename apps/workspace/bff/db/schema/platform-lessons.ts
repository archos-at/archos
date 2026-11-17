import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const PLATFORM_LESSON_CATEGORIES = ['inaccurate', 'too_slow', 'wrong_source', 'other'] as const
export type PlatformLessonCategory = (typeof PLATFORM_LESSON_CATEGORIES)[number]

export const PLATFORM_LESSON_STATUSES = ['candidate', 'active', 'retired'] as const
export type PlatformLessonStatus = (typeof PLATFORM_LESSON_STATUSES)[number]

export const PLATFORM_LESSON_ROOT_CAUSE_STATUSES = ['open', 'addressed'] as const
export type PlatformLessonRootCauseStatus = (typeof PLATFORM_LESSON_ROOT_CAUSE_STATUSES)[number]

export const PLATFORM_LESSON_REPORT_OUTCOMES = ['created', 'linked', 'skipped'] as const
export type PlatformLessonReportOutcome = (typeof PLATFORM_LESSON_REPORT_OUTCOMES)[number]

export const PLATFORM_LESSON_EVENT_ACTIONS = [
  'created',
  'report_linked',
  'activated',
  'retired',
  'reactivated',
  'edited',
  'root_cause_updated',
  'flagged_ineffective',
] as const
export type PlatformLessonEventAction = (typeof PLATFORM_LESSON_EVENT_ACTIONS)[number]

export const platformLessons = pgTable(
  'platform_lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    content: text('content').notNull(),
    category: text('category').$type<PlatformLessonCategory>().notNull(),
    status: text('status').$type<PlatformLessonStatus>().notNull().default('candidate'),
    heldReason: text('held_reason'),
    reportCount: integer('report_count').notNull().default(1),
    orgCount: integer('org_count').notNull().default(1),
    firstReportedAt: timestamp('first_reported_at', { withTimezone: true }).notNull().defaultNow(),
    lastReportedAt: timestamp('last_reported_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    activatedBy: text('activated_by'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredBy: text('retired_by'),
    retiredReason: text('retired_reason'),
    rootCauseStatus: text('root_cause_status')
      .$type<PlatformLessonRootCauseStatus>()
      .notNull()
      .default('open'),
    rootCauseNote: text('root_cause_note'),
    embedding: real('embedding').array(),
    embeddingModel: text('embedding_model'),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
    helpfulVotes: integer('helpful_votes').notNull().default(0),
    harmfulVotes: integer('harmful_votes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_platform_lessons_status').on(table.status),
  })
)

export const platformLessonReports = pgTable(
  'platform_lesson_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedbackId: uuid('feedback_id').notNull(),
    lessonId: uuid('lesson_id').references(() => platformLessons.id, { onDelete: 'cascade' }),
    outcome: text('outcome').$type<PlatformLessonReportOutcome>().notNull(),
    skipReason: text('skip_reason'),
    orgHash: text('org_hash').notNull(),
    canonicalSummary: text('canonical_summary'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    feedbackUidx: uniqueIndex('platform_lesson_reports_feedback_uidx').on(table.feedbackId),
    lessonIdx: index('idx_platform_lesson_reports_lesson').on(table.lessonId),
  })
)

export const platformLessonEvents = pgTable(
  'platform_lesson_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => platformLessons.id, { onDelete: 'cascade' }),
    action: text('action').$type<PlatformLessonEventAction>().notNull(),
    actor: text('actor').notNull(),
    actorEmail: text('actor_email'),
    detail: jsonb('detail').$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lessonIdx: index('idx_platform_lesson_events_lesson').on(table.lessonId, table.createdAt),
  })
)

export type PlatformLesson = typeof platformLessons.$inferSelect
export type NewPlatformLesson = typeof platformLessons.$inferInsert
export type PlatformLessonReport = typeof platformLessonReports.$inferSelect
export type NewPlatformLessonReport = typeof platformLessonReports.$inferInsert
export type PlatformLessonEvent = typeof platformLessonEvents.$inferSelect
export type NewPlatformLessonEvent = typeof platformLessonEvents.$inferInsert
