/**
 * The moves of `documents.status` (ADR-0179): which state a document's reading
 * may leave for which, derived from every writer of the column. Beside the
 * vocabulary (`./document-status`), which keeps what each state MEANS (its
 * colour and its phase); `reading-lifecycle.spec.ts` holds the two to each
 * other. No `server-only`: the browser may read it as it reads the tuple.
 *
 * Not the version lifecycle (`./version-lifecycle`): that is one version's way
 * through review, this is whether the item's current bytes were read.
 *
 * The events, and the writer of each:
 *
 * - `dispatch`: an ingest job took the row (`setDocumentIngestJob`).
 * - `process`: work the BFF runs itself took it, before any ingest job exists
 *   (`markDocumentProcessing`, a placement re-read, a Papierkorb restore).
 * - `complete`, `quarantine`, `cancel`: the job's outcome, mirrored from the
 *   backend by the reconcile (`setDocumentReconciledStatus`). That write is a
 *   compare-and-set on the status and the job the read saw, which is the guard
 *   that matters there: it tells a late report from a true one, and a list of
 *   states cannot.
 * - `fail`: the same mirror, or the BFF's own word that a read could not start
 *   or its local work failed (`markDocumentIngestFailed`).
 * - `resume`: the engine retries a job it had reported interrupted, so the
 *   mirror follows it back (`resolveInterruptedRow`).
 * - `unindex`: the bytes stay and nothing reads them (`markDocumentNotIndexed`:
 *   an archived document, a base-knowledge copy whose text is withheld).
 * - `replace`: a new version's bytes (`replaceDocumentWithinQuota`). No read
 *   of them has started, so the row is `uploaded` again until the dispatch
 *   that follows.
 * - `release`, `rescreen`: a reviewer sends a held file on, lifting the hold or
 *   asking the gate again (`markScreeningReleased`, `markForRescreening`).
 *   Offered where the row is at rest; the hold itself is not a status
 *   (`heldAtRest` in `./visibility`).
 *
 * The graph is dense because the domain is, not by neglect: a person may
 * read any file again, archive it or replace its bytes at any time. What it
 * does rule out is the part worth a rule: a quarantined row leaves only by a
 * release (migration 0122's trigger says the same in the database), and a
 * verdict (`completed`, `quarantined`, `cancelled`) is only ever a job's.
 *
 * `rescreen` is not declared from `quarantined` although the writer's WHERE
 * admits the row: the trigger refuses the write (`GQH01`), so the move does not
 * exist. `visibility.integration.spec.ts` holds that, and says what the trigger
 * would have to allow.
 */
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import type { DocumentStatus } from './document-status'

export type DocumentReadingEvent =
  | 'dispatch'
  | 'process'
  | 'complete'
  | 'fail'
  | 'quarantine'
  | 'cancel'
  | 'resume'
  | 'unindex'
  | 'replace'
  | 'release'
  | 'rescreen'

export const DOCUMENT_READING_LIFECYCLE = defineLifecycle<DocumentStatus, DocumentReadingEvent>({
  id: 'document-reading',
  // A person's upload. A document the agent wrote is filed `stored`: nothing
  // reads it until a version of it is published (`./generated`).
  initial: 'uploaded',
  bornAs: ['stored'],
  states: {
    uploaded: { on: { dispatch: 'pending', process: 'processing', fail: 'failed', unindex: 'stored' } },
    pending: {
      on: {
        complete: 'completed',
        fail: 'failed',
        quarantine: 'quarantined',
        cancel: 'cancelled',
        process: 'processing',
        unindex: 'stored',
        replace: 'uploaded',
      },
    },
    // No `cancel`: local work has no ingest job to stop. A verdict reaches a
    // `processing` row only through the re-read action's heal, which asks the
    // backend about a row whose local work was lost (`reingestDocument`).
    processing: {
      on: {
        dispatch: 'pending',
        complete: 'completed',
        fail: 'failed',
        quarantine: 'quarantined',
        unindex: 'stored',
        replace: 'uploaded',
      },
    },
    completed: {
      on: {
        dispatch: 'pending',
        process: 'processing',
        fail: 'failed',
        unindex: 'stored',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
    // `complete` from here is the heal of an interruption the job survived.
    failed: {
      on: {
        dispatch: 'pending',
        resume: 'pending',
        process: 'processing',
        complete: 'completed',
        unindex: 'stored',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
    quarantined: { on: { release: 'uploaded' } },
    stored: {
      on: {
        dispatch: 'pending',
        process: 'processing',
        fail: 'failed',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
    // `complete` from here is the heal of a stop that came as the job finished.
    cancelled: {
      on: {
        dispatch: 'pending',
        process: 'processing',
        complete: 'completed',
        fail: 'failed',
        unindex: 'stored',
        replace: 'uploaded',
        release: 'uploaded',
        rescreen: 'uploaded',
      },
    },
  },
})

/**
 * The states a write of `event` may land on: those the lifecycle moves from,
 * and the state the event leads to. The second half is not a move, and the
 * writers need it all the same: a lost job's row is dispatched again while it
 * still says `pending`, and a second failure restates `failed` with its reason.
 */
export function statusesAccepting(event: DocumentReadingEvent): DocumentStatus[] {
  const moves = DOCUMENT_READING_LIFECYCLE.moves.filter((move) => move.event === event)
  return DOCUMENT_READING_LIFECYCLE.states.filter((state) =>
    moves.some((move) => move.from === state || move.to === state),
  )
}
