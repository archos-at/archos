import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import type { CancelIngestOutcome } from './cancel-wire'
import { IN_FLIGHT_DOCUMENT_STATUSES } from './document-status'
import { cancelDocumentIngest } from './reingest'

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
