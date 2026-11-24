import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { getBackendUrl } from '@/lib/backend-proxy'
import { resolvePeople } from '@/lib/sharing/directory'
import { isNamespacedAgentDocument } from './agent-namespace'
import { collectionFileRef, purgeIngestedChunks } from './collection-file-ref'
import type { DispatchDocumentResult } from './document-dispatch'
import { resolveDocumentFolderPath } from './folder-path'
import type { AgentDocumentProvenance, IngestPriority } from './ingest-dispatch'
import { BACKEND_PURGE_TIMEOUT_MS } from './version-content'
import { findPublishedVersion } from './version-repository'

export async function ingestPublishedUpload(
  session: AuthorizedSession,
  document: Document,
  version: DocumentVersion,
): Promise<void> {
  if (version.contentHash !== null && version.contentHash === document.screenedHash) return
  const { dispatchDocument } = await import('./document-dispatch')
  await dispatchDocument({
    organizationId: session.organizationId,
    projectId: document.projectId,
    documentId: document.id,
    filename: document.filename,
    storageKey: version.storageKey,
    storageBucket: version.storageBucket,
    collectionName: document.collectionName,
    folderPath: await resolveDocumentFolderPath(document, session.organizationId),
  })
}

export async function purgeSupersededChunks(document: Document): Promise<void> {
  const ref = collectionFileRef(document)
  if (!ref) return
  await purgeIngestedChunks(getBackendUrl(), ref, BACKEND_PURGE_TIMEOUT_MS)
}

export async function agentProvenance(
  organizationId: string,
  document: Document,
  version: DocumentVersion,
): Promise<AgentDocumentProvenance> {
  const signedOffBy = version.approvedBy ?? version.publishedBy
  const signedOffAt = version.approvedAt ?? version.publishedAt
  const approver = signedOffBy ? (await resolvePeople(organizationId, [signedOffBy])).get(signedOffBy) : undefined
  return {
    authored_by: 'agent',
    approved_by: approver?.name ?? null,
    approved_at: signedOffAt?.toISOString() ?? null,
    producer: document.authoredByProducer,
  }
}

export async function redispatchPublishedVersion(
  organizationId: string,
  document: Document,
  priority: IngestPriority,
): Promise<DispatchDocumentResult> {
  const { dispatchDocument, AgentAuthoredDocumentNotIndexableError } = await import('./document-dispatch')
  const version = await findPublishedVersion(document.id, organizationId)
  if (!version || !isNamespacedAgentDocument(document)) {
    throw new AgentAuthoredDocumentNotIndexableError(document.id)
  }
  return dispatchDocument({
    organizationId,
    projectId: document.projectId,
    documentId: document.id,
    filename: document.filename,
    storageKey: version.storageKey,
    storageBucket: version.storageBucket,
    collectionName: document.collectionName,
    folderPath: await resolveDocumentFolderPath(document, organizationId),
    versionId: version.id,
    provenance: await agentProvenance(organizationId, document, version),
    priority,
  })
}
