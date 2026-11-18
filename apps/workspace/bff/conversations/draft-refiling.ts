import 'server-only'
import { BadRequestError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import { getAccessibleDocument } from '@/lib/documents/access'
import { reviseWithAgentWork, type AgentWork } from '@/lib/documents/agent-file-revision'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { findDocumentAuthoredByRef } from '@/lib/documents/repository'
import { findOpenVersion, findPublishedVersion } from '@/lib/documents/version-repository'
import { AGENT_REFUSAL_LOCALE } from '@/lib/conversations/restricted-egress'
import type { Locale } from '@/i18n/config'
import { recordDraftFilingInBackend } from './draft-backend'
import { readConversationDraftBytes } from './draft-file'
import type { DraftFileType } from './draft-media'
import { readConversationDraft, type DraftFacts, type DraftFiling } from './draft-preview'

export interface RefilingContext {
  session: AuthorizedSession
  conversationId: string
  projectId: string
  path: string
  type: DraftFileType
  facts: DraftFacts
  request?: Request
  locale?: Locale
}

export interface RefilingInput {
  overChanges?: boolean
  changeNote?: string
}

export interface RefiledDraft {
  documentId: string
  versionId: string
  state: DocumentVersionState
  alreadyFiled: boolean
  folderId: string | null
  folderName: string | null
  outcome: 'unchanged' | 'updated' | 'revised'
  versionNumber: number | null
  draftVersion: number
  revisionOf: { documentId: string; name: string } | null
}

export async function readDraftWork(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
  type: DraftFileType,
): Promise<AgentWork> {
  if (type.filing === 'file') {
    const draft = await readConversationDraftBytes(session, conversationId, path)
    return { kind: 'file', file: { contentType: type.contentType, bytes: draft.bytes } }
  }
  const draft = await readConversationDraft(session, conversationId, path)
  if (draft.encoding !== 'utf-8') {
    throw new UnprocessableError('This draft is not text and has no file type that can be filed', {
      reason: 'not-fileable',
      format: type.format,
      extension: type.extension,
    })
  }
  return { kind: 'markdown', content: draft.content }
}

export async function recordFiling(
  context: Pick<RefilingContext, 'conversationId' | 'path' | 'facts'>,
  documentId: string,
  version: Pick<DocumentVersion, 'id' | 'contentHash' | 'state'>,
): Promise<void> {
  if (!version.contentHash) return
  try {
    await recordDraftFilingInBackend(context.conversationId, `/${context.path}`, {
      documentId,
      versionId: version.id,
      contentHash: version.contentHash,
      state: version.state,
      draftVersion: context.facts.version,
    })
  } catch (error) {
    console.warn('[drafts] the filing could not be written back to the working directory', {
      cause: error instanceof Error ? error.name : 'unknown',
    })
  }
}

export async function legacyFiling(
  session: AuthorizedSession,
  projectId: string,
  ref: string,
  type: DraftFileType,
): Promise<DraftFiling | null> {
  const producer = type.filing === 'file' ? 'agent_file' : 'agent_document'
  const hit = await findDocumentAuthoredByRef(ref, session.organizationId, projectId, producer)
  if (!hit) return null
  const current =
    (await findOpenVersion(hit.id, session.organizationId)) ?? (await findPublishedVersion(hit.id, session.organizationId))
  if (!current) return null
  return {
    documentId: hit.id,
    versionId: current.id,
    contentHash: current.contentHash ?? '',
    state: current.state,
    filedAtVersion: 0,
  }
}

async function revise(
  context: RefilingContext,
  documentId: string,
  input: RefilingInput & { ifMatch?: string | null; agentFiledOnly: boolean },
) {
  const work = await readDraftWork(context.session, context.conversationId, context.path, context.type)
  const revised = await reviseWithAgentWork(context.session, {
    documentId,
    work,
    ifMatch: input.ifMatch,
    overChanges: input.overChanges,
    changeNote: input.changeNote,
    agentFiledOnly: input.agentFiledOnly,
    options: {
      request: context.request,
      origin: { conversationId: context.conversationId, locale: context.locale ?? AGENT_REFUSAL_LOCALE },
    },
  })
  await recordFiling(context, documentId, revised.version)
  return revised
}

export async function refile(
  context: RefilingContext,
  filed: DraftFiling,
  input: RefilingInput,
  folderNameOf: (folderId: string | null) => Promise<string | null>,
): Promise<RefiledDraft> {
  const unchanged = filed.filedAtVersion > 0 && filed.filedAtVersion >= context.facts.version
  if (unchanged) {
    const current = await findOpenVersion(filed.documentId, context.session.organizationId)
    const folder = await findDocumentAuthoredFolder(context, filed.documentId)
    return {
      documentId: filed.documentId,
      versionId: current?.id ?? filed.versionId,
      state: (current?.state ?? filed.state) as DocumentVersionState,
      alreadyFiled: true,
      folderId: folder,
      folderName: await folderNameOf(folder),
      outcome: 'unchanged',
      versionNumber: current?.versionNumber ?? null,
      draftVersion: context.facts.version,
      revisionOf: null,
    }
  }
  const { document, version } = await revise(context, filed.documentId, {
    ...input,
    ifMatch: filed.contentHash || null,
    agentFiledOnly: true,
  })
  return {
    documentId: document.id,
    versionId: version.id,
    state: version.state,
    alreadyFiled: true,
    folderId: document.folderId,
    folderName: await folderNameOf(document.folderId),
    outcome: 'updated',
    versionNumber: version.versionNumber,
    draftVersion: context.facts.version,
    revisionOf: null,
  }
}

async function findDocumentAuthoredFolder(context: RefilingContext, documentId: string): Promise<string | null> {
  return (await getAccessibleDocument(context.session, documentId)).folderId
}

export async function fileAsRevision(
  context: RefilingContext,
  input: RefilingInput,
  folderNameOf: (folderId: string | null) => Promise<string | null>,
): Promise<RefiledDraft> {
  const source = context.facts.derivedFrom
  if (!source) {
    throw new BadRequestError('This draft was not made from a project document', { reason: 'no-source-document' })
  }
  const { document, version } = await revise(context, source.documentId, { ...input, agentFiledOnly: false })
  return {
    documentId: document.id,
    versionId: version.id,
    state: version.state,
    alreadyFiled: false,
    folderId: document.folderId,
    folderName: await folderNameOf(document.folderId),
    outcome: 'revised',
    versionNumber: version.versionNumber,
    draftVersion: context.facts.version,
    revisionOf: { documentId: document.id, name: documentDisplayName(document) },
  }
}
