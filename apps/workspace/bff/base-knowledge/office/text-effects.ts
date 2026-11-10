/**
 * What a copy's text use changes outside the records (ADR-0158, design §4.7):
 * a metadata-only copy's passages leave the index and its row reads `stored`
 * (bytes kept, nothing reads them), and a copy whose text the office allowed
 * is read again. The dispatch guard (`documents/document-dispatch.ts`) keeps a
 * metadata-only copy out of every later re-read.
 */

import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBackendUrl } from '@/lib/backend-url'
import { collectionFileRef, purgeIngestedChunks } from '@/lib/documents/collection-file-ref'
import { dispatchDocument } from '@/lib/documents/document-dispatch'
import { resolveDocumentFolderPath } from '@/lib/documents/folder-path'
import { BACKEND_FETCH_TIMEOUT_MS } from '@/lib/documents/ingest-dispatch'
import { markDocumentNotIndexed } from '@/lib/documents/repository'
import { findOfficeShelfDocument } from '@/lib/office-shelf/repository'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'

async function shelfDocument(session: AuthorizedSession, documentId: string) {
  const reader = await shelfReaderFor(session, { scope: 'office_shelf', projectId: null })
  return findOfficeShelfDocument(documentId, session.organizationId, reader)
}

/** Take a metadata-only copy's text out of the index; the row keeps its bytes and reads `stored`. */
export async function withholdText(session: AuthorizedSession, documentId: string): Promise<boolean> {
  const doc = await shelfDocument(session, documentId)
  if (!doc) return false
  await markDocumentNotIndexed(doc.id, session.organizationId)
  const ref = collectionFileRef(doc)
  return ref ? purgeIngestedChunks(getBackendUrl(), ref, BACKEND_FETCH_TIMEOUT_MS) : true
}

/** Read a copy whose text the office has now allowed, as an upload is read. */
export async function releaseText(session: AuthorizedSession, documentId: string): Promise<void> {
  const doc = await shelfDocument(session, documentId)
  if (!doc?.storageKey) return
  await dispatchDocument({
    organizationId: session.organizationId,
    projectId: null,
    documentId: doc.id,
    filename: doc.filename,
    storageKey: doc.storageKey,
    storageBucket: doc.storageBucket,
    collectionName: doc.collectionName,
    folderPath: await resolveDocumentFolderPath(doc, session.organizationId),
  })
}
