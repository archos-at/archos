import 'server-only'
import { ApiError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { addBaseKnowledgeEdition } from '@/lib/base-knowledge/office/new-edition'
import { proposeFromReading } from '@/lib/base-knowledge/office/reading'
import {
  confirmBaseKnowledge,
  removeBaseKnowledge,
  uploadBaseKnowledge,
} from '@/lib/base-knowledge/office/service'
import type { BaseKnowledgeEntry, EntryValues } from '@/lib/base-knowledge/wire'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { documentDisplayName } from '@/lib/documents/display-name'
import { OFFICE_SHELF, projectShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { storedFileOf } from '@/lib/documents/stored-copy'
import { moveDocumentToBin } from '@/lib/projects/document-bin'
import type { ConfirmedNorm, OfficeShelfNormPayload, ProposedChangeResult } from '@/lib/proposals/types'
import { settleNormOffers } from './attention'
import { heldWorks } from './held-works'
import { isSettled, placementFor, type ShelfPlacement } from './placement'
import { insertReference } from './repository'
import type { NormPlacement } from './wire'

export const OFFICE_SHELF_MANAGE_NEEDED = 'office-shelf-manage-needed'
export const NORM_NOT_SETTLED = 'norm-not-settled'

export function requireOfficeShelfManage(session: AuthorizedSession): void {
  if (!canManageOfficeShelf(session)) {
    throw new ForbiddenError('Moving a norm into the office shelf needs org:office_shelf:manage; suggest it instead.', {
      reason: OFFICE_SHELF_MANAGE_NEEDED,
    })
  }
}

export async function writableProjectNorm(
  session: AuthorizedSession,
  projectId: string,
  documentId: string
): Promise<Document> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  if (document.scope !== 'project' || document.projectId !== projectId) throw new NotFoundError('Document not found')
  if (!isSettled(document)) {
    throw new ConflictError('This file is still being read or is held; place it once it has settled.', {
      reason: NORM_NOT_SETTLED,
    })
  }
  return document
}

export interface MoveNormInput {
  documentId: string
  values?: Partial<EntryValues>
  confirm?: boolean
}

const placed = (documentId: string, rest: Partial<NormPlacement> & Pick<NormPlacement, 'outcome'>): NormPlacement => ({
  documentId,
  officeDocumentId: null,
  entryId: null,
  referenceId: null,
  proposalId: null,
  reason: null,
  ...rest,
})

async function fileInOfficeShelf(
  session: AuthorizedSession,
  document: Document,
  name: string,
  placement: Exclude<ShelfPlacement, { kind: 'duplicate' }>,
  input: MoveNormInput,
  request: Request
): Promise<BaseKnowledgeEntry> {
  const file = await storedFileOf(document, name)
  return placement.kind === 'edition'
    ? addBaseKnowledgeEdition(session, placement.of.entry.editionId, file, request)
    : uploadBaseKnowledge(session, file, request, input.values ?? {})
}

async function confirmed(
  session: AuthorizedSession,
  entry: BaseKnowledgeEntry,
  input: MoveNormInput
): Promise<{ entry: BaseKnowledgeEntry; reason: string | null }> {
  if (!input.confirm || entry.status === 'confirmed') return { entry, reason: null }
  try {
    return { entry: await confirmBaseKnowledge(session, entry.id, input.values ?? {}), reason: null }
  } catch (error) {
    if (error instanceof ApiError) return { entry, reason: error.message }
    throw error
  }
}

export async function moveNormToOfficeShelf(
  session: AuthorizedSession,
  projectId: string,
  input: MoveNormInput,
  request: Request
): Promise<NormPlacement> {
  requireOfficeShelfManage(session)
  const document = await writableProjectNorm(session, projectId, input.documentId)
  await assertNoActiveHold(session.organizationId, 'document', document.id)
  const name = documentDisplayName(document)
  const reading = proposeFromReading({ fileName: name }, {})
  const placement = placementFor(
    {
      designation: input.values?.designation ?? reading.designation,
      editionLabel: input.values?.editionLabel ?? reading.editionLabel,
      contentHash: document.contentHash,
    },
    await heldWorks(session)
  )
  const reference = {
    organizationId: session.organizationId,
    projectId,
    folderId: document.folderId,
    sourceDocumentId: document.id,
    fileName: name,
    createdBy: session.userId,
  }

  if (placement.kind === 'duplicate') {
    await moveDocumentToBin(session, document.id, request)
    const row = await insertReference({ ...reference, officeDocumentId: placement.of.entry.documentId, placedAs: 'duplicate' })
    await afterMove(session, projectId, document.id)
    return placed(document.id, {
      outcome: 'duplicate',
      officeDocumentId: placement.of.entry.documentId,
      entryId: placement.of.entry.editionId,
      referenceId: row.id,
    })
  }

  const filed = await fileInOfficeShelf(session, document, name, placement, input, request)
  try {
    await moveDocumentToBin(session, document.id, request)
  } catch (error) {
    await removeBaseKnowledge(session, filed.id, request).catch((cause: unknown) =>
      console.error(`[office-shelf] the copy of ${document.id} stayed in the office shelf after its move failed`, cause)
    )
    throw error
  }
  const { entry, reason } = await confirmed(session, filed, input)
  const row = await insertReference({
    ...reference,
    officeDocumentId: entry.documentId,
    placedAs: placement.kind === 'edition' ? 'edition' : 'moved',
  })
  await afterMove(session, projectId, document.id)
  return placed(document.id, {
    outcome: placement.kind === 'edition' ? 'edition' : 'moved',
    officeDocumentId: entry.documentId,
    entryId: entry.id,
    referenceId: row.id,
    reason,
  })
}

async function afterMove(session: AuthorizedSession, projectId: string, documentId: string): Promise<void> {
  publishShelfChanged(session.organizationId, projectShelf(projectId))
  publishShelfChanged(session.organizationId, OFFICE_SHELF)
  await settleNormOffers(session.organizationId, [documentId])
}

export async function moveNormsToOfficeShelf(
  session: AuthorizedSession,
  projectId: string,
  inputs: readonly MoveNormInput[],
  request: Request
): Promise<NormPlacement[]> {
  requireOfficeShelfManage(session)
  const placements: NormPlacement[] = []
  for (const input of inputs) {
    try {
      placements.push(await moveNormToOfficeShelf(session, projectId, input, request))
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      placements.push(placed(input.documentId, { outcome: 'refused', reason: error.message }))
    }
  }
  return placements
}

export async function applyOfficeShelfNorm(
  payload: OfficeShelfNormPayload,
  context: { session: AuthorizedSession; projectId: string; request: Request; norms?: readonly ConfirmedNorm[] }
): Promise<ProposedChangeResult[]> {
  const confirmedValues = new Map((context.norms ?? []).map((norm) => [norm.documentId, norm.values]))
  const placements = await moveNormsToOfficeShelf(
    context.session,
    context.projectId,
    payload.documents.map((document) => {
      const values = confirmedValues.get(document.id)
      return values ? { documentId: document.id, values, confirm: true } : { documentId: document.id }
    }),
    context.request
  )
  return payload.documents.map((document, index) => {
    const outcome = placements[index]
    const label = document.designation ?? document.name
    return outcome.outcome === 'refused'
      ? { label, ok: false, reason: outcome.reason ?? 'Not moved.' }
      : { label, ok: true, itemId: outcome.officeDocumentId ?? undefined, ...(outcome.reason ? { reason: outcome.reason } : {}) }
  })
}
