import 'server-only'
import { BadRequestError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import { getAccessibleDocument } from '@/lib/documents/access'
import { reviseWithAgentWork, type AgentWork, type RevisedWithAgentWork } from '@/lib/documents/agent-file-revision'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { findDocumentAuthoredByRef } from '@/lib/documents/repository'
import { findOpenVersion, findPublishedVersion, listDocumentVersions } from '@/lib/documents/version-repository'
import { AGENT_REFUSAL_LOCALE } from '@/lib/conversations/restricted-egress'
import type { Locale } from '@/i18n/config'
import { recordDraftFilingInBackend } from './draft-backend'
import { readConversationDraftBytes } from './draft-file'
import type { DraftFileType } from './draft-media'
import { readConversationDraft, type DraftFacts, type DraftFiling, type DraftFilingKind } from './draft-preview'

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
  kind: DraftFilingKind = '',
): Promise<void> {
  if (!version.contentHash) return
  try {
    await recordDraftFilingInBackend(context.conversationId, `/${context.path}`, {
      documentId,
      versionId: version.id,
      contentHash: version.contentHash,
      state: version.state,
      draftVersion: context.facts.version,
      kind,
    })
  } catch (error) {
    console.warn('[drafts] the filing could not be written back to the working directory', {
      cause: error instanceof Error ? error.name : 'unknown',
    })
  }
}

export async function legacyFiling(
  context: Pick<RefilingContext, 'session' | 'projectId' | 'conversationId' | 'type'>,
  ref: string,
): Promise<DraftFiling | null> {
  const { session } = context
  const producer = context.type.filing === 'file' ? 'agent_file' : 'agent_document'
  const hit = await findDocumentAuthoredByRef(ref, session.organizationId, context.projectId, producer)
  if (!hit) return null
  const versions = await listDocumentVersions(hit.id, session.organizationId)
  const written = [...versions].reverse().find((version) => version.originConversationId === context.conversationId)
  const own = written ?? versions[0]
  if (!own) return null
  return {
    documentId: hit.id,
    versionId: own.id,
    contentHash: own.contentHash ?? '',
    state: own.state,
    filedAtVersion: 0,
    kind: '',
  }
}

async function revise(
  context: RefilingContext,
  documentId: string,
  input: RefilingInput & { ifMatch?: string | null; ownVersionId?: string | null; agentFiledOnly: boolean },
  kind: DraftFilingKind,
): Promise<RevisedWithAgentWork> {
  const work = await readDraftWork(context.session, context.conversationId, context.path, context.type)
  const revised = await reviseWithAgentWork(context.session, {
    documentId,
    projectId: context.projectId,
    work,
    ifMatch: input.ifMatch,
    ownVersionId: input.ownVersionId,
    overChanges: input.overChanges,
    changeNote: input.changeNote,
    agentFiledOnly: input.agentFiledOnly,
    options: {
      request: context.request,
      origin: { conversationId: context.conversationId, locale: context.locale ?? AGENT_REFUSAL_LOCALE },
    },
  })
  await recordFiling(context, documentId, revised.version, kind)
  return revised
}

async function answer(
  revised: RevisedWithAgentWork,
  context: RefilingContext,
  folderNameOf: (folderId: string | null) => Promise<string | null>,
  revision: boolean,
): Promise<RefiledDraft> {
  const { document, version } = revised
  return {
    documentId: document.id,
    versionId: version.id,
    state: version.state,
    alreadyFiled: !revision,
    folderId: document.folderId,
    folderName: await folderNameOf(document.folderId),
    outcome: revision ? 'revised' : revised.unchanged ? 'unchanged' : 'updated',
    versionNumber: version.versionNumber,
    draftVersion: context.facts.version,
    revisionOf: revision ? { documentId: document.id, name: documentDisplayName(document) } : null,
  }
}

async function unchangedFiling(
  context: RefilingContext,
  filed: DraftFiling,
  folderNameOf: (folderId: string | null) => Promise<string | null>,
): Promise<RefiledDraft> {
  const document = await getAccessibleDocument(context.session, filed.documentId)
  const current =
    (await findOpenVersion(filed.documentId, context.session.organizationId)) ??
    (await findPublishedVersion(filed.documentId, context.session.organizationId))
  return {
    documentId: filed.documentId,
    versionId: current?.id ?? filed.versionId,
    state: (current?.state ?? filed.state) as DocumentVersionState,
    alreadyFiled: true,
    folderId: document.folderId,
    folderName: await folderNameOf(document.folderId),
    outcome: 'unchanged',
    versionNumber: current?.versionNumber ?? null,
    draftVersion: context.facts.version,
    revisionOf: null,
  }
}

export async function refile(
  context: RefilingContext,
  filed: DraftFiling,
  input: RefilingInput,
  folderNameOf: (folderId: string | null) => Promise<string | null>,
): Promise<RefiledDraft | null> {
  const revision = filed.kind === 'revision'
  try {
    if (filed.filedAtVersion > 0 && filed.filedAtVersion >= context.facts.version) {
      return await unchangedFiling(context, filed, folderNameOf)
    }
    const revised = await revise(
      context,
      filed.documentId,
      { ...input, ifMatch: filed.contentHash || null, ownVersionId: filed.versionId, agentFiledOnly: !revision },
      revision ? 'revision' : '',
    )
    return await answer(revised, context, folderNameOf, revision)
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
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
  if (context.type.filing !== 'file') {
    throw new UnprocessableError('A Markdown draft cannot become a Fassung of a person’s document', {
      reason: 'not-fileable',
    })
  }
  const revised = await revise(
    context,
    source.documentId,
    { ...input, ifMatch: source.contentHash ?? null, agentFiledOnly: false },
    'revision',
  )
  return answer(revised, context, folderNameOf, true)
}
