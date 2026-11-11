import { sql } from 'drizzle-orm'
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

export type DeletionEntityType = 'project' | 'document' | 'conversation' | 'organization' | 'user' | 'folder'

export const DELETION_STATUSES = ['pending', 'purging', 'purged', 'restored', 'failed'] as const
export type DeletionStatus = (typeof DELETION_STATUSES)[number]

/**
 * Claims a queue row gets before it is `failed` and waits for a person. The
 * purger is plain JavaScript and keeps its own copy (`purger/db.js`,
 * `MAX_ATTEMPTS`); `purger/deletion-lifecycle.spec.mjs` holds the two equal.
 */
export const DELETION_MAX_ATTEMPTS = 10

/**
 * A queued deletion's lifecycle (ADR-0179), from every writer of the status:
 * the purger (`purger/db.js`), the Papierkorb (`projects/folder-bin-repository.ts`),
 * the project restore (`projects/repository.ts`) and the chat erasure
 * (`conversations/repository.ts`).
 *
 * A row is born `pending`. A holder claims it (`purging`): the purger once it
 * is due, or „Endgültig löschen" in a request, which may also `retry` a
 * `failed` row. The holder finishes it, releases it for another pass (a failed
 * attempt with attempts left, a legal hold, or the purge done and only the
 * traces owed to the purger), or fails it. The purger takes a `purging` row
 * over once its claim is 15 minutes old (`reclaim`). A project or folder is
 * restored only while `pending` and never claimed. A chat's delete request
 * erases in the request and closes its own row without claiming it, and closes
 * a `failed` one when a repeated delete worked.
 *
 * A claim is a token: every claim writes a fresh `claimed_at`, and a holder's
 * closing write (finish, release, fail) matches the one it took, so a holder
 * whose stale claim was taken over changes nothing. `failed` is also closed
 * `purged` where the erasure is proven: by the holder whose purge finished
 * after the reap had failed its row, and for a folder the BFF marked purged
 * with no traces owed (`closeErased`, `purger/db.js`).
 *
 * Attempts are not a state: a `pending` row always has attempts left, and the
 * one that has none is `failed`. The database refuses the other reading
 * (`deletion_queue_pending_has_attempts`, migration 0227): the purger claims a
 * row only below the cap, so a `pending` row at it would wait for ever.
 */
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
    // Migration 0223; generated from the tuple so the CHECK and the type cannot drift.
    statusKnown: check(
      'deletion_queue_status_known',
      sql`${table.status} IN (${sql.raw(DELETION_STATUSES.map((status) => `'${status}'`).join(', '))})`
    ),
    // Migration 0227; the cap comes from the constant so the CHECK and the writers cannot drift.
    pendingHasAttempts: check(
      'deletion_queue_pending_has_attempts',
      sql`${table.status} <> 'pending' OR ${table.attempts} < ${sql.raw(String(DELETION_MAX_ATTEMPTS))}`
    ),
  })
)

export type DeletionQueueEntry = typeof deletionQueue.$inferSelect
export type NewDeletionQueueEntry = typeof deletionQueue.$inferInsert
