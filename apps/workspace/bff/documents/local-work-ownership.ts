/**
 * Whether a document row still belongs to the local work that was started for
 * it: an IFC extraction or an office conversion on the job queue, or the sweep
 * over rows a dead job left behind.
 *
 * The rule is asked twice: of a row in memory before the work starts
 * (`jobStillOwnsRow`, `./extraction-jobs`), and as the WHERE of the write that
 * records its failure afterwards (`stillOwnedBy`, `./repository/ingest-state`).
 * This module is the pure half and the type both read;
 * `local-work-ownership.integration.spec.ts` holds the two to the same answer,
 * so the check before the work and the write after it cannot disagree.
 *
 * No database import, so a unit spec can apply the rule to its fixtures.
 */

/** The `documents.metadata` key that names the queue job working on a `processing` row. */
export const BACKGROUND_JOB_METADATA_FIELD = 'bffJobId'

/**
 * What local work knows of the row it was started for: the bytes it reads, the
 * queue job it is. Either, or both.
 */
export interface LocalWorkOwnership {
  storageKey?: string
  backgroundJobId?: string | null
  /**
   * A row that names no job yet still belongs to this one. For a queue job
   * asking about itself: the job is enqueued first and written onto the row
   * after (`queueDocumentWork`), and a job reused for a second dispatch runs
   * while `markDocumentProcessing` has dropped the name for the new round. A
   * job that took "no name" for "not mine" would leave, and the row would wait
   * at `processing` for work nobody does. The sweep leaves this off: it acts on
   * a row only while the row names the dead job it read.
   */
  unnamedCounts?: boolean
}

/** The row facts the rule reads. */
export interface LocalWorkRow {
  status: string
  storageKey: string | null
  metadata: unknown
}

function namedBackgroundJob(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const named = (metadata as Record<string, unknown>)[BACKGROUND_JOB_METADATA_FIELD]
  return typeof named === 'string' ? named : null
}

/**
 * The row is still that work's: at `processing` (every other writer moves it
 * off), holding the bytes the work reads, and naming the job the work is. A new
 * round of local work renames the job and, for new bytes, the key, so work
 * that began earlier no longer matches.
 */
export function localWorkOwnsRow(row: LocalWorkRow, owned: LocalWorkOwnership): boolean {
  if (row.status !== 'processing') return false
  if (owned.storageKey && row.storageKey !== owned.storageKey) return false
  if (!owned.backgroundJobId) return true
  const named = namedBackgroundJob(row.metadata)
  if (named === null) return owned.unnamedCounts === true
  return named === owned.backgroundJobId
}
