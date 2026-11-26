import 'server-only'
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { checkAgentFile } from '@/lib/documents/agent-file-check'
import { stampAgentFile } from '@/lib/documents/agent-file-marking'
import { renderAgentDocumentMarkdown } from '@/lib/documents/agent-document-markdown'
import { AGENT_FILE_PRODUCER } from '@/lib/documents/agent-file'
import { resolveDocumentBranding } from '@/lib/documents/branding'
import { memberReader } from '@/lib/documents/document-reader'
import { documentNameMatchKey } from '@/lib/documents/name-match'
import type { DocumentNameMatchRow } from '@/lib/documents/repository'
import { generatedDocumentMarking, generatedDocumentProvenance } from '@/lib/documents/generated'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { findShelfFolder } from '@/lib/documents/shelf-folders'
import { personalShelf } from '@/lib/documents/shelf'
import { findOpenVersion, findPublishedVersion } from '@/lib/documents/version-repository'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { findPersonalShelfDocument } from '@/lib/personal-shelf/repository'
import { probePersonalShelfDocumentNames, uploadToPersonalShelf } from '@/lib/personal-shelf/service'
import { AGENT_REFUSAL_LOCALE, requireMayFileFrom } from '@/lib/conversations/restricted-egress'
import type { FileConversationDraftInput, FiledConversationDraft } from './draft-filing'
import { draftFileName, filedExtension } from './draft-media'
import { readDraftWork, recordFiling, type RefilingContext } from './draft-refiling'

export type PersonalFilingContext = Omit<RefilingContext, 'projectId'>

interface RenderedDraft {
  bytes: Uint8Array
  contentType: string
}

async function renderDraft(context: PersonalFilingContext, ref: string): Promise<RenderedDraft> {
  const { session, conversationId, path, type } = context
  const work = await readDraftWork(session, conversationId, path, type)
  if (work.kind === 'file') {
    const checked = checkAgentFile(work.file.bytes, work.file.contentType)
    const marking = generatedDocumentMarking(AGENT_FILE_PRODUCER, ref)
    const bytes = stampAgentFile(checked, generatedDocumentProvenance(AGENT_FILE_PRODUCER, ref), marking)
    return { bytes, contentType: checked.contentType }
  }
  const organizationName = await getOrganizationDisplayName(session.organizationId)
  const branding = await resolveDocumentBranding({ organizationId: session.organizationId, organizationName, filed: true })
  const rendered = renderAgentDocumentMarkdown(work.content, generatedDocumentMarking('agent_document', ref), branding)
  return { bytes: rendered.bytes, contentType: rendered.contentType }
}

async function personalFolderName(session: AuthorizedSession, folderId: string | null): Promise<string | null> {
  if (folderId === null) return null
  return (await findShelfFolder(personalShelf(session.userId), session.organizationId, folderId))?.name ?? null
}

function withSuffix(filename: string, n: number): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? `${filename.slice(0, dot)} (${n})${filename.slice(dot)}` : `${filename} (${n})`
}

async function namesInFolder(session: AuthorizedSession, names: readonly string[], folderId: string | null): Promise<DocumentNameMatchRow[]> {
  const rows = await probePersonalShelfDocumentNames(session, names)
  return rows.filter((row) => (row.folderId ?? null) === folderId)
}

async function freeName(session: AuthorizedSession, filename: string, folderId: string | null): Promise<string> {
  const candidates = [filename, ...Array.from({ length: 20 }, (_, i) => withSuffix(filename, i + 2))]
  const taken = await namesInFolder(session, candidates, folderId)
  const takenKeys = new Set(taken.flatMap((row) => [row.filename, ...(row.displayName ? [row.displayName] : [])]).map(documentNameMatchKey))
  const free = candidates.find((name) => !takenKeys.has(documentNameMatchKey(name)))
  if (!free) throw new ConflictError('Too many files with this name are already in Meine Ablage', { reason: 'name-exhausted' })
  return free
}

async function filedAnswer(
  context: PersonalFilingContext,
  documentId: string,
  folderId: string | null,
  outcome: FiledConversationDraft['outcome'],
): Promise<FiledConversationDraft> {
  const { session } = context
  const version =
    (await findOpenVersion(documentId, session.organizationId)) ??
    (await findPublishedVersion(documentId, session.organizationId))
  if (!version) throw new NotFoundError('The filed document has no version')
  if (outcome !== 'unchanged') await recordFiling(context, documentId, version)
  return {
    documentId,
    versionId: version.id,
    state: version.state as DocumentVersionState,
    alreadyFiled: outcome !== 'filed',
    folderId,
    folderName: await personalFolderName(session, folderId),
    outcome,
    versionNumber: version.versionNumber ?? null,
    draftVersion: context.facts.version,
    revisionOf: null,
  }
}

export async function fileDraftToPersonalShelf(
  context: PersonalFilingContext,
  input: FileConversationDraftInput,
  ref: string,
  filingName: (name: string, extension: string) => string,
): Promise<FiledConversationDraft> {
  const { session, conversationId, request, facts } = context
  if (!request) throw new BadRequestError('Filing into Meine Ablage needs the request')
  if (input.as === 'revision') {
    throw new BadRequestError('A draft in a personal chat cannot become a Fassung of a project document', {
      reason: 'no-source-document',
    })
  }

  const reader = memberReader(session.userId)
  const previous =
    facts.filing && input.as !== 'own'
      ? await findPersonalShelfDocument(facts.filing.documentId, session.organizationId, session.userId, reader)
      : null
  const folderId = previous ? (previous.folderId ?? null) : (input.folderId ?? null)

  await requireMayFileFrom(
    { conversationId, locale: context.locale ?? AGENT_REFUSAL_LOCALE, release: context.release },
    {
      organizationId: session.organizationId,
      projectId: null,
      projectCollection: personalShelfCollectionName(session.organizationId, session.userId),
      folderId,
    },
  )

  if (previous && facts.filing && facts.filing.filedAtVersion > 0 && facts.filing.filedAtVersion >= facts.version) {
    return filedAnswer(context, previous.id, previous.folderId ?? null, 'unchanged')
  }

  const extension = filedExtension(context.type)
  const wanted = filingName(input.name ?? (input.title?.trim() || draftFileName(context.path)), extension)
  const filename = previous ? previous.filename : input.force ? await freeName(session, wanted, folderId) : wanted
  if (!previous && !input.force) {
    const [clash] = await namesInFolder(session, [filename], folderId)
    if (clash) {
      throw new ConflictError('A file with this name is already in this folder of Meine Ablage', {
        reason: 'same-name',
        documentId: clash.id,
        displayName: clash.filename,
      })
    }
  }

  const rendered = await renderDraft(context, ref)
  const file = new File([Buffer.from(rendered.bytes)], filename, { type: rendered.contentType })
  const uploaded = await uploadToPersonalShelf(session, file, request, {
    folderId,
    originConversationId: conversationId,
  })
  const outcome = previous ? (uploaded.unchanged ? 'unchanged' : 'updated') : 'filed'
  return filedAnswer(context, uploaded.documentId, folderId, outcome)
}
