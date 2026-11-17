import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { filedInOf } from '@/lib/audit/document-names'
import { recordAuditEvent } from '@/lib/audit/service'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from './access'
import { collectionFileRef } from './collection-file-ref'
import { resolveDocumentFolderPath } from './folder-path'
import { redispatchPublishedVersion } from './lifecycle'
import { markDocumentIngestFailed } from './repository'
import { dispatchDocument } from './document-dispatch'
import { INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'
import { documentShelf } from './shelf'
import { publishShelfChanged } from './shelf-live'
import { setDocumentLifecycle } from './version-repository'

export interface UnarchiveDocumentResult {
  documentId: string
  lifecycle: 'active'
  ingest: 'queued' | 'held' | 'failed' | 'unchanged'
}

async function readAgain(organizationId: string, doc: Document): Promise<'queued' | 'held' | 'failed'> {
  if (doc.status === 'quarantined') return 'held'
  if (!collectionFileRef(doc) || !doc.storageKey) {
    await markDocumentIngestFailed(doc.id, organizationId, INGEST_DISPATCH_FAILED_MESSAGE)
    return 'failed'
  }
  try {
    const { status } =
      doc.authoredBy === 'user'
        ? await dispatchDocument({
            organizationId,
            projectId: doc.projectId,
            documentId: doc.id,
            filename: doc.filename,
            storageKey: doc.storageKey,
            storageBucket: doc.storageBucket,
            collectionName: doc.collectionName,
            folderPath: await resolveDocumentFolderPath(doc, organizationId),
          })
        : await redispatchPublishedVersion(organizationId, doc, 'interactive')
    return status === 'failed' ? 'failed' : 'queued'
  } catch (error) {
    console.warn(`[unarchive] re-ingest of ${doc.id} failed:`, error)
    await markDocumentIngestFailed(doc.id, organizationId, INGEST_DISPATCH_FAILED_MESSAGE)
    return 'failed'
  }
}

export async function unarchiveDocument(
  session: AuthorizedSession,
  documentId: string,
  request?: Request,
): Promise<UnarchiveDocumentResult> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  if (document.projectId) {
    await requireProjectAccess(session, document.projectId, ['project:documents:write', 'project:edit'])
  }
  if (document.lifecycle !== 'archived') return { documentId, lifecycle: 'active', ingest: 'unchanged' }
  await setDocumentLifecycle(documentId, session.organizationId, 'active')
  publishShelfChanged(session.organizationId, documentShelf(document))
  const ingest = await readAgain(session.organizationId, document)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'document.unarchived',
    targetType: 'document',
    targetId: documentId,
    filedIn: filedInOf(document),
    metadata: {
      projectId: document.projectId ?? '',
      filename: document.filename.slice(0, 200),
      collectionName: document.collectionName,
      ingest,
    },
    request,
  })
  return { documentId, lifecycle: 'active', ingest }
}
