import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { folderTree, isUnderOwnList, type FolderTree } from '@/lib/authz/folder-access-rule'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { listOfficeShelfFolders } from '@/lib/office-shelf/folder-service'
import type { Document } from '@/lib/db/schema/documents'
import type { UploadBatch } from '@/lib/db/schema/upload-batches'
import { hasPassedScreening, memberReader, SCREENED_ONLY } from '@/lib/documents/document-reader'
import { reconcileDocumentStatuses } from '@/lib/documents/reconcile-status'
import { OFFICE_SHELF, projectShelf, type DocumentShelf } from '@/lib/documents/shelf'
import { surfaceStateOf } from '@/lib/documents/surface-state'
import { documentTypeOf, DISCIPLINE_TAGS } from '@/lib/documents/tag-vocabulary'
import type { FolderRow } from '@/lib/documents/shelf-folders'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { listProjectFolders } from '@/lib/projects/folder-service'
import { folderPathKey } from '@/lib/projects/folders'
import { isProjectClosed } from '@/lib/projects/project-status'
import { findProjectInOrg, listProjectsInOrg } from '@/lib/projects/repository'
import { projectsHolding } from '@/lib/projects/service'
import { createProposal, listShelfFileProposals, withdrawProposal } from '@/lib/proposals/service'
import type { ProposalShelf } from '@/lib/proposals/repository'
import { findUploadBatch, listBatchDocuments } from '@/lib/upload-batches/repository'
import { docTypesByFolder, officeConventions, type FiledSample } from './conventions'
import { judgeFiling } from './judge'
import { planFiling, type RecordedProposal } from './plan'
import { listFiledDocuments, listProjectsFolders } from './repository'
import {
  MAX_JUDGED_DOCUMENTS,
  MAX_JUDGED_FOLDERS,
  type FilingBasis,
  type FilingDocumentInput,
  type FilingFolderInput,
} from './types'

const CONVENTION_PROJECTS = 20
const CONVENTION_SAMPLE_PROJECTS = 3
export const REASON_LOCALE = 'de'

export interface FilingReviewOutcome {
  status: 'skipped' | 'judged' | 'failed'
  reason?: string
  proposed: number
  withdrawn: number
  sinceSealMs: number | null
}

const skipped = (reason: string): FilingReviewOutcome => ({ status: 'skipped', reason, proposed: 0, withdrawn: 0, sinceSealMs: null })

export interface ShelfFolders {
  rows: FolderRow[]
  pathOf: (folderId: string | null) => string
  isRestricted: (folderId: string | null) => boolean
}

export async function shelfFolders(session: AuthorizedSession, shelf: DocumentShelf): Promise<ShelfFolders> {
  const [rows, tree] = await Promise.all([
    shelf.kind === 'project' ? listProjectFolders(shelf.projectId, session) : listOfficeShelfFolders(session),
    shelf.kind === 'project'
      ? listProjectFolderTree(session.organizationId, shelf.projectId).then(folderTree)
      : Promise.resolve<FolderTree>(new Map()),
  ])
  const paths = new Map(rows.map((row) => [row.id, row.path]))
  return {
    rows,
    pathOf: (folderId) => (folderId ? (paths.get(folderId) ?? '') : ''),
    isRestricted: (folderId) => folderId !== null && (!paths.has(folderId) || isUnderOwnList(tree, folderId)),
  }
}

export async function shelfDocTypes(organizationId: string, shelf: DocumentShelf, folders: ShelfFolders) {
  const sample = await listFiledDocuments(organizationId, shelf, SCREENED_ONLY)
  const enriched = await reconcileDocumentStatuses(sample, organizationId, 'read')
  const samples: FiledSample[] = enriched
    .filter((row) => hasPassedScreening(row) && !folders.isRestricted(row.folderId))
    .map((row) => ({ folderPath: folders.pathOf(row.folderId), tags: row.tags }))
  return docTypesByFolder(samples)
}

export async function conventionsFor(
  session: AuthorizedSession,
  projectId: string,
  existingPaths: readonly string[],
  withDocTypes: boolean
) {
  const recent = (await listProjectsInOrg(session.organizationId, { limit: CONVENTION_PROJECTS + 1 })).filter(
    (project) => project.id !== projectId
  )
  const open = await projectsHolding(session, recent.slice(0, CONVENTION_PROJECTS), ['project:view'])
  const rows = await listProjectsFolders(
    session.organizationId,
    open.map((project) => project.id)
  )
  let docTypes = new Map<string, string[]>()
  if (withDocTypes) {
    const sampled = await Promise.all(
      open.slice(0, CONVENTION_SAMPLE_PROJECTS).map(async (project) => {
        const shelf = projectShelf(project.id)
        const folders = await shelfFolders(session, shelf)
        return shelfDocTypes(session.organizationId, shelf, folders)
      })
    )
    docTypes = new Map(sampled.flatMap((perProject) => [...perProject.entries()]))
  }
  return officeConventions(rows, existingPaths, docTypes)
}

async function batchDocuments(
  session: AuthorizedSession,
  batch: UploadBatch,
  basis: FilingBasis
): Promise<{ judged: Array<Document & { tags?: string[]; summary?: string }>; all: Document[] }> {
  const all = await listBatchDocuments(session.organizationId, batch.id, memberReader(session.userId))
  if (basis === 'name') {
    return { judged: all.filter((row) => row.status !== 'quarantined'), all }
  }
  const screened = await listBatchDocuments(session.organizationId, batch.id, SCREENED_ONLY)
  const enriched = await reconcileDocumentStatuses(screened, session.organizationId, 'read')
  return {
    judged: enriched.filter((row) => hasPassedScreening(row) && surfaceStateOf(row.status) === 'citable'),
    all,
  }
}

export function documentInput(
  row: Document & { tags?: string[]; summary?: string },
  folders: ShelfFolders,
  basis: FilingBasis
): FilingDocumentInput {
  const tags = basis === 'content' ? (row.tags ?? []) : []
  return {
    id: row.id,
    file: row.filename,
    folder: folders.pathOf(row.folderId),
    type: documentTypeOf(tags) ?? null,
    tags: tags.filter((tag) => (DISCIPLINE_TAGS as readonly string[]).includes(tag)),
    summary: basis === 'content' ? (row.summary?.slice(0, 800) ?? null) : null,
  }
}

const proposalShelfOf = (shelf: DocumentShelf): ProposalShelf =>
  shelf.kind === 'project' ? { scope: 'project', projectId: shelf.projectId } : { scope: 'office_shelf' }

export async function reviewUploadFiling(
  session: AuthorizedSession,
  batchId: string,
  basis: FilingBasis
): Promise<FilingReviewOutcome> {
  const organizationId = session.organizationId
  const batch = await findUploadBatch(organizationId, batchId)
  if (!batch || batch.createdBy !== session.userId) return skipped('not-the-uploaders-batch')
  if (batch.scope === 'session') return skipped('chat-attachments')
  if (basis === 'name' && batch.completedAt) return skipped('already-read')
  let shelf: DocumentShelf = OFFICE_SHELF
  if (batch.scope === 'project') {
    if (!batch.projectId) return skipped('no-project')
    const project = await findProjectInOrg(batch.projectId, organizationId)
    if (!project) return skipped('no-project')
    if (isProjectClosed(project)) return skipped('project-closed')
    shelf = projectShelf(batch.projectId)
  }

  const [folders, documents] = await Promise.all([shelfFolders(session, shelf), batchDocuments(session, batch, basis)])
  const openFolders = folders.rows.filter((row) => !folders.isRestricted(row.id))
  const judgedDocuments = documents.judged
    .filter((row) => !folders.isRestricted(row.folderId))
    .sort((a, b) => Number(a.folderId !== null) - Number(b.folderId !== null))
    .slice(0, MAX_JUDGED_DOCUMENTS)
  if (judgedDocuments.length === 0) return skipped('nothing-to-judge')

  const docTypes = await shelfDocTypes(organizationId, shelf, folders)
  const folderInputs: FilingFolderInput[] = openFolders.slice(0, MAX_JUDGED_FOLDERS).map((row) => ({
    path: row.path,
    description: row.description,
    docTypes: docTypes.get(folderPathKey(row.path)) ?? [],
  }))
  const conventions =
    shelf.kind === 'project'
      ? await conventionsFor(session, shelf.projectId, folders.rows.map((row) => row.path), basis === 'content')
      : []

  const judgement = await judgeFiling(organizationId, {
    basis,
    locale: REASON_LOCALE,
    folders: folderInputs,
    conventions,
    documents: judgedDocuments.map((row) => documentInput(row, folders, basis)),
    trace: { batchId: batch.id, projectId: batch.projectId, shelf: shelf.kind },
  })
  if (judgement.error) {
    console.warn(`[filing] batch ${batch.id} (${basis}) was not judged: ${judgement.error}`)
    return { status: 'failed', reason: judgement.error, proposed: 0, withdrawn: 0, sinceSealMs: null }
  }

  const record = await listShelfFileProposals(organizationId, proposalShelfOf(shelf))
  const plan = planFiling({
    basis,
    shelf: shelf.kind,
    documents: judgedDocuments.map((row) => ({ id: row.id, filename: row.filename })),
    batchFilenames: documents.all.map((row) => row.filename),
    judged: true,
    moves: judgement.moves,
    restrictedDocumentIds: new Set(documents.all.filter((row) => folders.isRestricted(row.folderId)).map((row) => row.id)),
    restrictedPaths: folders.rows.filter((row) => folders.isRestricted(row.id)).map((row) => row.path),
    record: record.flatMap((entry): RecordedProposal[] =>
      entry.typed.kind === 'file_operation'
        ? [
            {
              id: entry.id,
              status: entry.status,
              payload: entry.typed.payload,
              originConversationId: entry.originConversationId,
              claimed: entry.claimed,
            },
          ]
        : []
    ),
  })

  let withdrawn = 0
  for (const id of plan.withdraw) if (await withdrawProposal(organizationId, id)) withdrawn += 1
  for (const payload of plan.create) {
    await createProposal(session, {
      projectId: shelf.kind === 'project' ? shelf.projectId : null,
      kind: 'file_operation',
      payload,
      conversationId: null,
      answerMessageId: null,
      originTraceId: judgement.traceId,
    })
  }
  if (plan.create.length > 0 || withdrawn > 0) publishShelfChanged(organizationId, shelf)
  const sinceSealMs = batch.sealedAt ? Date.now() - new Date(batch.sealedAt).getTime() : null
  console.debug(
    `[filing] batch ${batch.id} (${basis}): ${plan.create.length} proposed, ${withdrawn} withdrawn, ` +
      `${judgedDocuments.length} judged, ${sinceSealMs ?? '?'} ms after the seal`
  )
  return { status: 'judged', proposed: plan.create.length, withdrawn, sinceSealMs }
}
