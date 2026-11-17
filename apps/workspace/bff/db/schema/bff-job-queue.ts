import { integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const BFF_JOB_PRIORITY = { interactive: 0, bulk: 1 } as const
export type BffJobPriorityName = keyof typeof BFF_JOB_PRIORITY
export type BffJobPriority = (typeof BFF_JOB_PRIORITY)[BffJobPriorityName]

export type BffJobStatus = 'queued' | 'claimed' | 'dead'

export const bffJobQueue = pgTable('bff_job_queue', {
  jobId: uuid('job_id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  lane: text('lane').notNull(),
  priority: smallint('priority').$type<BffJobPriority>().notNull().default(0),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').$type<BffJobStatus>().notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  claimedBy: text('claimed_by'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  notBefore: timestamp('not_before', { withTimezone: true }),
  deadAt: timestamp('dead_at', { withTimezone: true }),
})

export const bffJobLaneTurns = pgTable('bff_job_lane_turns', {
  lane: text('lane').primaryKey(),
  lastClaimedAt: timestamp('last_claimed_at', { withTimezone: true }),
})

export type BffJobRow = typeof bffJobQueue.$inferSelect
export type NewBffJobRow = typeof bffJobQueue.$inferInsert
