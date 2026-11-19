import 'server-only'
import type { Document } from '@/lib/db/schema/documents'
import type { UploadBatch } from '@/lib/db/schema/upload-batches'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { internalRead } from '@/lib/documents/document-reader'
import { isQuarantineReviewer } from '@/lib/documents/quarantine-reviewers'
import { announceSettledVersions } from '@/lib/documents/revision-notify'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, type InboxEmission } from '@/lib/inbox/service'
import { findProjectInOrg } from '@/lib/projects/repository'
import { queueIntakeReadsAfterUpload } from '@/lib/project-intake/trigger'
import { queueFilingReviewsAfterSettle } from '@/lib/filing/trigger'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { quarantineNoticePayload } from '@/lib/upload-screening/quarantine'
import { auditOwedQuarantines } from '@/lib/upload-screening/quarantine-audit'
import { batchIdsOfDocuments, completeSettledBatches, reopenCompletedBatches } from './repository'
import { uploadReportFor } from './upload-report-service'

export interface SettledDocument {
  id: string
  status: string
  correction?: boolean
}

export async function onDocumentsSettled(organizationId: string, settled: readonly SettledDocument[]): Promise<void> {
  if (settled.length === 0) return
  try {
    const quarantined = settled.filter((row) => row.status === 'quarantined').map((row) => row.id)
    if (quarantined.length > 0) await onQuarantined(organizationId, quarantined)
    const batchIds = await batchIdsOfDocuments(
      organizationId,
      settled.map((row) => row.id)
    )
    await settleUploadBatches(organizationId, batchIds)
    void announceSettledVersions(
      organizationId,
      settled
        .filter((row) => !row.correction && row.status !== 'quarantined' && row.status !== 'cancelled')
        .map((row) => row.id)
    ).catch((error) => console.warn('[upload-batches] announcing new Fassungen failed:', error))
  } catch (error) {
    console.warn('[upload-batches] settling after reconciliation failed; the sweep retries:', error)
  }
}

export async function settleUploadBatches(organizationId: string, batchIds: readonly string[]): Promise<UploadBatch[]> {
  const completedAt = new Date()
  const completed = await completeSettledBatches(organizationId, batchIds, completedAt)
  if (completed.length === 0) return completed
  try {
    const announced = completed.filter((batch) => batch.announcesCompletion)
    const emissions = await Promise.all(announced.map((batch) => completionEmission(batch)))
    if (emissions.length > 0) await emitInboxItems(emissions)
  } catch (error) {
    await reopenCompletedBatches(
      organizationId,
      completed.map((batch) => batch.id),
      completedAt
    )
    throw error
  }
  await startIntakeReadings(organizationId, completed)
  await queueFilingReviewsAfterSettle(organizationId, completed)
  return completed
}

async function startIntakeReadings(organizationId: string, completed: readonly UploadBatch[]): Promise<void> {
  try {
    await queueIntakeReadsAfterUpload(organizationId, completed)
  } catch (error) {
    console.warn('[upload-batches] queueing the intake reading failed; the next upload or a click starts it:', error)
  }
}

async function projectNameOf(batch: UploadBatch): Promise<string | null> {
  if (batch.scope !== 'project' || !batch.projectId) return null
  const project = await findProjectInOrg(batch.projectId, batch.organizationId)
  return project?.name ?? null
}

async function completionEmission(batch: UploadBatch): Promise<InboxEmission> {
  const [subject, report] = await Promise.all([
    projectNameOf(batch),
    uploadReportFor(batch).catch(() => null),
  ])
  return {
    organizationId: batch.organizationId,
    recipientUserId: batch.createdBy,
    type: 'upload.completed',
    resourceType: 'upload_batch',
    resourceId: batch.id,
    anchorId: batch.id,
    actorUserId: null,
    groupKey: inboxGroupKey('upload.completed', 'upload_batch', batch.id, batch.id),
    payload: { ...(subject ? { subject } : {}), ...(report ? { report } : {}) },
  }
}

export async function quarantineReviewersOf(organizationId: string, document: Document): Promise<string[]> {
  const directory = await loadOrganizationDirectory(organizationId)
  const verdicts = await Promise.all(
    [...directory.keys()].map(async (userId) =>
      (await isQuarantineReviewer(organizationId, document, userId)) ? userId : null
    )
  )
  return verdicts.filter((userId): userId is string => userId !== null)
}

async function onQuarantined(organizationId: string, documentIds: readonly string[]): Promise<void> {
  await auditOwedQuarantines(organizationId, documentIds)
  const documents = (
    await Promise.all(documentIds.map((id) => findDocumentInOrg(id, organizationId, internalRead('audit'))))
  ).filter(
    (row): row is Document => row !== null
  )
  await notifyQuarantineReviewers(organizationId, documents)
}

async function notifyQuarantineReviewers(organizationId: string, documents: readonly Document[]): Promise<void> {
  const emissions: InboxEmission[] = []
  for (const document of documents) {
    for (const reviewer of await quarantineReviewersOf(organizationId, document)) {
      emissions.push({
        organizationId,
        recipientUserId: reviewer,
        type: 'document.quarantined',
        resourceType: 'organization',
        resourceId: organizationId,
        actorUserId: document.createdBy,
        groupKey: inboxGroupKey('document.quarantined', 'organization', organizationId),
        payload: quarantineNoticePayload(document),
      })
    }
  }
  await emitInboxItems(emissions)
}
