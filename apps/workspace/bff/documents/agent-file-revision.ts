import 'server-only'
import { ConflictError, UnprocessableError } from '@/lib/api/errors'
import { markingIsInBytes } from '@/lib/ai-provenance'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from './access'
import { AGENT_FILE_PRODUCER, type AgentFileUpload } from './agent-file'
import { checkAgentFile, refuse } from './agent-file-check'
import { stampAgentFile } from './agent-file-marking'
import { normalizeContentType } from './agent-file-types'
import { contentDigest } from './content-digest'
import { generatedDocumentMarking, generatedDocumentProvenance, UnmarkedRenderingError } from './generated'
import { replaceVersionFile, transitionDocumentVersion, type ReplaceVersionOptions } from './lifecycle'
import { openDraftForRevision } from './revision'
import { renderVersionBytes, type RenderedVersionBytes } from './version-content'
import { findOpenVersion, findPublishedVersion, MAX_CHANGE_NOTE_CHARS } from './version-repository'

export type AgentWork = { kind: 'file'; file: AgentFileUpload } | { kind: 'markdown'; content: string }

export interface ReviseWithAgentWorkInput {
  documentId: string
  projectId: string
  work: AgentWork
  ifMatch?: string | null
  ownVersionId?: string | null
  overChanges?: boolean
  changeNote?: string | null
  agentFiledOnly?: boolean
  options: ReplaceVersionOptions
}

export interface RevisedWithAgentWork {
  document: Document
  version: DocumentVersion
  forked: boolean
  unchanged: boolean
}

const EDITABLE: ReadonlySet<string> = new Set(['draft', 'changes_requested'])

export function renderRevisionFile(document: Document, version: DocumentVersion, file: AgentFileUpload): RenderedVersionBytes {
  const checked = checkAgentFile(file.bytes, file.contentType)
  const current = normalizeContentType(version.contentType ?? document.contentType ?? '')
  if (checked.contentType !== current) {
    throw refuse('not-the-declared-type', `this document is ${current}; file a ${checked.contentType} as a new document`)
  }
  const ref = document.authoredByRef ?? document.id
  const marking = generatedDocumentMarking(AGENT_FILE_PRODUCER, ref)
  const bytes = Buffer.from(stampAgentFile(checked, generatedDocumentProvenance(AGENT_FILE_PRODUCER, ref), marking))
  if (!markingIsInBytes(bytes, marking)) throw new UnmarkedRenderingError(AGENT_FILE_PRODUCER, checked.contentType)
  return { bytes, contentType: checked.contentType, contentHash: contentDigest(bytes) }
}

function render(work: AgentWork, document: Document, version: DocumentVersion): Promise<RenderedVersionBytes> | RenderedVersionBytes {
  return work.kind === 'file'
    ? renderRevisionFile(document, version, work.file)
    : renderVersionBytes(document, version, work.content, { filed: true })
}

async function currentVersion(session: AuthorizedSession, documentId: string): Promise<DocumentVersion | null> {
  return (await findOpenVersion(documentId, session.organizationId)) ?? findPublishedVersion(documentId, session.organizationId)
}

function refuseOtherHands(document: Document, current: DocumentVersion | null, input: ReviseWithAgentWorkInput): void {
  if (current?.state === 'in_review') {
    throw new ConflictError('This document is in review and cannot get a new Fassung now', {
      reason: 'in-review',
      versionNumber: current.versionNumber,
    })
  }
  if (input.overChanges || !current) return
  const changed = Boolean(input.ifMatch && current.contentHash && current.contentHash !== input.ifMatch)
  const someoneElsesDraft = EDITABLE.has(current.state) && current.id !== input.ownVersionId
  if (changed || someoneElsesDraft) {
    throw new ConflictError('A person changed this document since the draft was made or filed', {
      reason: 'changed-in-project',
      documentId: document.id,
      versionNumber: current.versionNumber,
    })
  }
}

function refuseWrongDocument(document: Document, input: ReviseWithAgentWorkInput): void {
  if (document.projectId !== input.projectId) {
    throw new UnprocessableError('That document belongs to another project', { reason: 'other-project' })
  }
  if (input.agentFiledOnly && (document.authoredBy === 'user' || !document.authoredByProducer?.startsWith('agent_'))) {
    throw new ConflictError('Only a document the agent filed can be updated from its draft', {
      producer: document.authoredByProducer,
    })
  }
  if (!input.agentFiledOnly && input.work.kind !== 'file') {
    throw new UnprocessableError('A Markdown draft cannot become a Fassung of a person’s document', {
      reason: 'not-fileable',
    })
  }
}

export async function reviseWithAgentWork(
  session: AuthorizedSession,
  input: ReviseWithAgentWorkInput,
): Promise<RevisedWithAgentWork> {
  const document = await getAccessibleDocument(session, input.documentId, 'write')
  refuseWrongDocument(document, input)
  const current = await currentVersion(session, document.id)
  refuseOtherHands(document, current, input)
  if (current) {
    const rendered = await render(input.work, document, current)
    if (rendered.contentHash === current.contentHash) return { document, version: current, forked: false, unchanged: true }
  }
  const open = current && EDITABLE.has(current.state) ? current : null
  const target = open ?? (await openDraftForRevision(session, document.id)).version
  const note = input.changeNote?.trim().slice(0, MAX_CHANGE_NOTE_CHARS) || null
  const written = await replaceVersionFile(
    session,
    document.id,
    target.id,
    target.contentHash,
    { ...input.options, versionFields: { changeNote: note } },
    async (doc, version) => render(input.work, doc, version),
  )
  const version = await transitionDocumentVersion(session, document.id, written.id, 'file', {
    request: input.options.request,
    actingHuman: input.options.actingHuman,
  })
  return { document, version, forked: open === null, unchanged: false }
}
