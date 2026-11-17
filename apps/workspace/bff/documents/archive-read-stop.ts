/**
 * Archiving a document that is still being read stops that read first.
 *
 * `archiveDocument` (`./version-content`) purges the document's chunks and
 * marks the row `stored`. A job still reading it knows nothing of that: it
 * goes on, writes its chunks after the purge, and the archived document
 * answers questions again. So the read is stopped with the machinery the stop
 * route uses (`cancelDocumentIngest`), and the archive follows.
 *
 * Never throws. The archive is what the person asked for, and a queue that
 * cannot be reached must not leave a document they believe archived in the
 * working set; the outcome rides on the audit event instead, and a job that
 * was not stopped is told the document is gone when it asks before keeping its
 * chunks (`documentExistsInCollection`).
 */

import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import type { CancelIngestOutcome } from './cancel-wire'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import { cancelDocumentIngest } from './reingest'

/**
 * What became of the read: the stop's own answer, `unreachable` when the stop
 * could not be asked for, or `null` for a document that was not being read.
 */
export type ArchiveReadStop = CancelIngestOutcome | 'unreachable' | null

export async function stopReadBeforeArchive(
  session: AuthorizedSession,
  document: Pick<Document, 'id' | 'status'>,
): Promise<ArchiveReadStop> {
  if (!IN_FLIGHT_DOCUMENT_STATUSES.has(document.status)) return null
  try {
    return (await cancelDocumentIngest(session, document.id)).result
  } catch (error) {
    console.warn(`[archive] could not stop the read of ${document.id}:`, error)
    return 'unreachable'
  }
}
