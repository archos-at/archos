import 'server-only'
import { ApiError, NotFoundError } from '@/lib/api/errors'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canWriteFolder, getProjectFolderAccess } from '@/lib/authz/folder-access'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { officeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import type { OfficeShelfReference } from '@/lib/db/schema/office-shelf-references'
import type { UploadBatch } from '@/lib/db/schema/upload-batches'
import { memberReader } from '@/lib/documents/document-reader'
import { projectShelf } from '@/lib/documents/shelf'
import { requireShelfRead } from '@/lib/documents/shelf-authz'
import { findProjectInOrg } from '@/lib/projects/repository'
import { listBatchDocuments } from '@/lib/upload-batches/repository'
import { announceNorms, normOfferEmissions, settleNormOffers } from './attention'
import { heldWorks } from './held-works'
import { moveNormsToOfficeShelf, writableProjectNorm } from './move'
import { offerable, recognizedNorms, type NormCandidateRow } from './placement'
import { keepInProject, keptAmong, listProjectNormRows, listReferences } from './repository'
import { suggestedNormDocuments, suggestNormsForOfficeShelf } from './suggest'
import type {
  ListProjectNormsQuery,
  NormOffer,
  NormPlacement,
  OfficeShelfReferenceView,
  PlaceProjectNormsBody,
  PlaceProjectNormsResponse,
  ProjectNormsResponse,
} from './wire'
import { NORM_REFERENCE_PAGE } from './wire'

async function offersAmong(
  session: AuthorizedSession,
  projectId: string,
  rows: readonly NormCandidateRow[]
): Promise<NormOffer[]> {
  const norms = recognizedNorms(rows)
  if (norms.length === 0) return []
  const ids = norms.map((norm) => norm.documentId)
  const [kept, suggested, works] = await Promise.all([
    keptAmong(session.organizationId, ids),
    suggestedNormDocuments(session.organizationId, projectId, ['proposed', 'dismissed']),
    heldWorks(session),
  ])
  return offerable(norms, { kept, suggested: new Set(suggested.keys()), works })
}

function referenceView(row: OfficeShelfReference): OfficeShelfReferenceView {
  return {
    id: row.id,
    fileName: row.fileName,
    folderId: row.folderId,
    placedAs: row.placedAs,
    state: row.officeDocumentId ? 'in_office_shelf' : 'removed',
    officeDocumentId: row.officeDocumentId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }
}

export async function listProjectNorms(
  session: AuthorizedSession,
  projectId: string,
  query: ListProjectNormsQuery
): Promise<ProjectNormsResponse> {
  await requireShelfRead(session, projectShelf(projectId))
  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError('Project not found')
  const folderId = query.folderId ?? null
  const access = await getProjectFolderAccess(session, projectId, project.collectionName)
  if (!access.isVisible(folderId)) throw new NotFoundError('Folder not found')
  const start = query.cursor ? Number(query.cursor) : 0
  const limit = query.limit ?? NORM_REFERENCE_PAGE
  const [rows, references, canWrite] = await Promise.all([
    start === 0 ? listProjectNormRows(session.organizationId, projectId, { folderId }, memberReader(session.userId)) : [],
    listReferences(session.organizationId, projectId, folderId, { offset: start, limit: limit + 1 }),
    canWriteFolder(session, projectId, folderId),
  ])
  return {
    canManageOfficeShelf: canManageOfficeShelf(session),
    canWrite,
    offers: canWrite ? await offersAmong(session, projectId, rows) : [],
    references: references.slice(0, limit).map(referenceView),
    nextCursor: references.length > limit ? String(start + limit) : null,
  }
}

async function keepNorms(session: AuthorizedSession, projectId: string, documentIds: readonly string[]): Promise<NormPlacement[]> {
  const placements: NormPlacement[] = []
  const kept: string[] = []
  for (const documentId of new Set(documentIds)) {
    const base = { documentId, officeDocumentId: null, entryId: null, referenceId: null, proposalId: null }
    try {
      await writableProjectNorm(session, projectId, documentId)
      kept.push(documentId)
      placements.push({ ...base, outcome: 'kept', reason: null })
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      placements.push({ ...base, outcome: 'refused', reason: error.message })
    }
  }
  await keepInProject(session.organizationId, projectId, kept, session.userId)
  await settleNormOffers(session.organizationId, kept)
  return placements
}

export async function placeProjectNorms(
  session: AuthorizedSession,
  projectId: string,
  body: PlaceProjectNormsBody,
  request: Request
): Promise<PlaceProjectNormsResponse> {
  const ids = body.documents.map((document) => document.documentId)
  switch (body.destination) {
    case 'project':
      return { destination: 'project', visibility: 'project', placements: await keepNorms(session, projectId, ids), notified: 0 }
    case 'suggest': {
      const { placements, notified } = await suggestNormsForOfficeShelf(session, projectId, ids)
      return { destination: 'suggest', visibility: 'office', placements, notified }
    }
    case 'office_shelf': {
      const placements = await moveNormsToOfficeShelf(
        session,
        projectId,
        body.documents.map((document) => ({ documentId: document.documentId, values: document.values, confirm: body.confirm })),
        request
      )
      return { destination: 'office_shelf', visibility: 'office', placements, notified: 0 }
    }
  }
}

type OfferedBatch = Pick<UploadBatch, 'id' | 'scope' | 'projectId' | 'createdBy'>

export async function offerNormsAfterSettle(organizationId: string, completed: readonly OfferedBatch[]): Promise<void> {
  const batches = completed.filter((batch) => batch.scope === 'project' && batch.projectId)
  if (batches.length === 0) return
  try {
    if (!(await officeStandardsEnabled(organizationId))) return
    for (const batch of batches) await offerBatch(organizationId, batch)
  } catch (error) {
    console.warn('[office-shelf] offering the norms of an upload failed; the project banner still offers them:', error)
  }
}

async function offerBatch(organizationId: string, batch: OfferedBatch): Promise<void> {
  const projectId = batch.projectId
  if (!projectId) return
  const session = await resolvePinnedRequesterSession({ userId: batch.createdBy, email: null, organizationId })
  const project = await findProjectInOrg(projectId, organizationId)
  if (!session || !project) return
  const uploaded = await listBatchDocuments(organizationId, batch.id, memberReader(batch.createdBy))
  const rows = await listProjectNormRows(
    organizationId,
    projectId,
    { documentIds: uploaded.map((document) => document.id) },
    memberReader(batch.createdBy)
  )
  const writable: NormCandidateRow[] = []
  for (const row of rows) if (await canWriteFolder(session, projectId, row.folderId)) writable.push(row)
  const offers = await offersAmong(session, projectId, writable)
  await announceNorms(
    organizationId,
    normOfferEmissions({ organizationId, projectId, projectName: project.name, recipientUserId: batch.createdBy, offers })
  )
}
