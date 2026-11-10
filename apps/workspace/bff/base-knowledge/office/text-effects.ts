/**
 * What a copy's text use changes outside the records (ADR-0163, design §4.7):
 * a held copy's passages and its search row (summary, facets) go and its row
 * reads `stored` (bytes kept, nothing reads them), and a copy whose text the
 * person released is read again. The guards (`base-knowledge/text-guard.ts`,
 * asked by the dispatch and the search projection) keep a held copy out of
 * every later re-read.
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
import { deleteSearchFacets } from '@/lib/search/facets-repository'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'

async function shelfDocument(session: AuthorizedSession, documentId: string) {
  const reader = await shelfReaderFor(session, { scope: 'office_shelf', projectId: null })
  return findOfficeShelfDocument(documentId, session.organizationId, reader)
}

/** Take a held copy's text out of the index and the search rows; the row keeps its bytes and reads `stored`. */
export async function withholdText(session: AuthorizedSession, documentId: string): Promise<boolean> {
  const doc = await shelfDocument(session, documentId)
  if (!doc) return false
  await markDocumentNotIndexed(doc.id, session.organizationId)
  await deleteSearchFacets(session.organizationId, doc.id)
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
