import 'server-only'
import { ApiError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { proposeFromReading, recognizeNorm } from '@/lib/base-knowledge/office/reading'
import { UNKNOWN_EDITION } from '@/lib/base-knowledge/wire'
import { documentDisplayName } from '@/lib/documents/display-name'
import { findProjectInOrg } from '@/lib/projects/repository'
import { auditProposalCreated } from '@/lib/proposals/audit'
import { insertProposedChange, listShelfProposals } from '@/lib/proposals/repository'
import { officeShelfNormPayloadSchema, type ProposedChangeStatus } from '@/lib/proposals/types'
import { announceNorms, settleNormOffers, normSuggestionEmissions } from './attention'
import { normDecidersOf } from './managers'
import { writableProjectNorm } from './move'
import type { NormPlacement, PlaceProjectNormsBody } from './wire'

export async function suggestedNormDocuments(
  organizationId: string,
  projectId: string,
  statuses: readonly ProposedChangeStatus[]
): Promise<Map<string, string>> {
  const rows = await listShelfProposals(
    organizationId,
    { scope: 'project', projectId },
    { statuses, kind: 'office_shelf_norm', limit: 500 }
  )
  const byDocument = new Map<string, string>()
  for (const row of rows) {
    const parsed = officeShelfNormPayloadSchema.safeParse(row.payload)
    if (!parsed.success) continue
    for (const document of parsed.data.documents) if (!byDocument.has(document.id)) byDocument.set(document.id, row.id)
  }
  return byDocument
}

const refused = (documentId: string, reason: string): NormPlacement => ({
  documentId,
  outcome: 'refused',
  officeDocumentId: null,
  entryId: null,
  referenceId: null,
  proposalId: null,
  reason,
})

const suggested = (documentId: string, proposalId: string): NormPlacement => ({
  documentId,
  outcome: 'suggested',
  officeDocumentId: null,
  entryId: null,
  referenceId: null,
  proposalId,
  reason: null,
})

const NOBODY_DECIDES = 'Nobody who manages the office shelf may write here, so nobody could decide this suggestion.'

export interface NormSuggestion {
  placements: NormPlacement[]
  notified: number
  noDecider: { managers: string[] } | null
}

type SuggestedNorm = PlaceProjectNormsBody['documents'][number]

function suggestedDocument(document: Document, values: SuggestedNorm['values']) {
  const name = documentDisplayName(document).slice(0, 512)
  const recognized = recognizeNorm({ fileName: name })
  const read = proposeFromReading({ fileName: name }, {})
  return {
    id: document.id,
    name,
    designation: values?.designation !== undefined ? values.designation : recognized.norm ? recognized.designation : null,
    kind: values?.kind ?? read.kind,
    editionLabel: values?.editionLabel ?? (read.editionLabel === UNKNOWN_EDITION ? null : read.editionLabel),
  }
}

export async function suggestNormsForOfficeShelf(
  session: AuthorizedSession,
  projectId: string,
  documents: readonly SuggestedNorm[]
): Promise<NormSuggestion> {
  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError('Project not found')
  const documentIds = documents.map((document) => document.documentId)
  const open = await suggestedNormDocuments(session.organizationId, projectId, ['proposed'])
  const outcomes = new Map<string, NormPlacement>()
  const fresh: Document[] = []
  for (const documentId of new Set(documentIds)) {
    try {
      const document = await writableProjectNorm(session, projectId, documentId)
      const proposalId = open.get(documentId)
      if (proposalId) outcomes.set(documentId, suggested(documentId, proposalId))
      else fresh.push(document)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      outcomes.set(documentId, refused(documentId, error.message))
    }
  }
  const answer = (notified: number, noDecider: NormSuggestion['noDecider']): NormSuggestion => ({
    placements: documentIds.map((documentId) => outcomes.get(documentId) ?? refused(documentId, 'Not placed.')),
    notified,
    noDecider,
  })
  if (fresh.length === 0) return answer(0, null)

  const { deciders, managers } = await normDecidersOf(
    session.organizationId,
    projectId,
    fresh.map((document) => document.folderId),
    session.userId
  )
  if (deciders.length === 0) {
    for (const document of fresh) outcomes.set(document.id, refused(document.id, NOBODY_DECIDES))
    return answer(0, { managers })
  }
  const valuesOf = new Map(documents.map((document) => [document.documentId, document.values]))
  const payload = officeShelfNormPayloadSchema.parse({
    documents: fresh.map((document) => suggestedDocument(document, valuesOf.get(document.id))),
  })
  const { row } = await insertProposedChange({
    organizationId: session.organizationId,
    projectId,
    scope: 'project',
    kind: 'office_shelf_norm',
    payload,
    proposedByKind: 'person',
    onBehalfOf: session.userId,
    originConversationId: null,
    originMessageId: null,
  })
  auditProposalCreated(session, row, { kind: 'office_shelf_norm', payload })
  await announceNorms(
    session.organizationId,
    normSuggestionEmissions({
      organizationId: session.organizationId,
      projectId,
      projectName: project.name,
      proposalId: row.id,
      suggestedBy: session.userId,
      recipients: deciders,
      names: payload.documents.map((document) => document.designation ?? document.name),
      folderId: fresh[0].folderId,
    })
  )
  for (const document of fresh) outcomes.set(document.id, suggested(document.id, row.id))
  await settleNormOffers(
    session.organizationId,
    fresh.map((document) => document.id)
  )
  return answer(deciders.length, null)
}
