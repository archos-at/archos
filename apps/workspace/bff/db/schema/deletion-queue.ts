import { sql } from 'drizzle-orm'
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

export type DeletionEntityType = 'project' | 'document' | 'conversation' | 'organization' | 'user' | 'folder'

export const DELETION_STATUSES = ['pending', 'purging', 'purged', 'restored', 'failed'] as const
export type DeletionStatus = (typeof DELETION_STATUSES)[number]

export const DELETION_MAX_ATTEMPTS = 10

export const DELETION_LIFECYCLE = defineLifecycle<
  DeletionStatus,
  'claim' | 'reclaim' | 'retry' | 'finish' | 'release' | 'fail' | 'restore' | 'close'
>({
  id: 'deletion',
  initial: 'pending',
  states: {
    pending: { on: { claim: 'purging', restore: 'restored', close: 'purged' } },
    purging: { on: { reclaim: 'purging', finish: 'purged', release: 'pending', fail: 'failed' } },
    purged: { type: 'final' },
    restored: { type: 'final' },
    failed: { on: { retry: 'purging', close: 'purged' } },
  },
})

export const deletionQueue = pgTable(
  'deletion_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').$type<DeletionEntityType>().notNull(),
    entityId: text('entity_id').notNull(),
    displayName: text('display_name').notNull(),
    organizationId: text('organization_id').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    purgeAfter: timestamp('purge_after', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    status: text('status').$type<DeletionStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
  },
  (table) => ({
    statusKnown: check(
      'deletion_queue_status_known',
      sql`${table.status} IN (${sql.raw(DELETION_STATUSES.map((status) => `'${status}'`).join(', '))})`
    ),
    pendingHasAttempts: check(
      'deletion_queue_pending_has_attempts',
      sql`${table.status} <> 'pending' OR ${table.attempts} < ${sql.raw(String(DELETION_MAX_ATTEMPTS))}`
    ),
  })
)

export type DeletionQueueEntry = typeof deletionQueue.$inferSelect
export type NewDeletionQueueEntry = typeof deletionQueue.$inferInsert
