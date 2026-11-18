import 'server-only'
import { BadRequestError, ConflictError } from '@/lib/api/errors'
import { markingIsInBytes } from '@/lib/ai-provenance'
import type { AuthorizedSession } from '@/lib/auth/types'
import { AGENT_REFUSAL_LOCALE } from '@/lib/conversations/restricted-egress'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { fileSlug } from '@/lib/text/latinize'
import type { Locale } from '@/i18n/config'
import { recordGeneratedDraft, type FiledAgentDocumentDraft } from './agent-document'
import { checkAgentFile, refuse } from './agent-file-check'
import { stampAgentFile } from './agent-file-marking'
import { AGENT_FILE_TYPES, normalizeContentType, type AgentFileContentType } from './agent-file-types'
import { contentDigest } from './content-digest'
import {
  fileGeneratedDocument,
  generatedDocumentMarking,
  generatedDocumentProvenance,
  UnmarkedRenderingError,
} from './generated'
import { replaceVersionFile, type ReplaceVersionOptions } from './lifecycle'
import type { RenderedVersionBytes } from './version-content'

export const AGENT_FILE_PRODUCER = 'agent_file'

export interface AgentFileUpload {
  contentType: string
  bytes: Uint8Array
}

export interface FileAgentFileDraftInput extends AgentFileUpload {
  session: AuthorizedSession
  projectId: string
  ref: string
  title: string
  filename?: string
  folderId?: string | null
  request?: Request
  actingHuman?: boolean
  originConversationId?: string | null
  locale?: Locale
}

const FILENAME_STEM_LENGTH = 120

export function agentFileName(filename: string | undefined, contentType: AgentFileContentType): string | undefined {
  if (filename === undefined) return undefined
  const base = filename.split(/[\\/]/).pop()?.trim() ?? ''
  const expected = AGENT_FILE_TYPES[contentType].extension
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  if (extension !== expected) {
    throw new BadRequestError(
      `The filename must end in .${expected} for ${contentType}${extension ? `, not .${extension}` : ''}.`,
      { filename, expected },
    )
  }
  const stem = fileSlug(base.slice(0, dot), { lowercase: false, maxLength: FILENAME_STEM_LENGTH })
  return `${stem || 'document'}.${expected}`
}

export async function fileAgentFileDraft(input: FileAgentFileDraftInput): Promise<FiledAgentDocumentDraft> {
  const checked = checkAgentFile(input.bytes, input.contentType)
  const filename = agentFileName(input.filename, checked.contentType)
  const provenance = generatedDocumentProvenance(AGENT_FILE_PRODUCER, input.ref)
  let stored: Uint8Array | null = null

  const filed = await fileGeneratedDocument({
    session: input.session,
    projectId: input.projectId,
    producer: AGENT_FILE_PRODUCER,
    ref: input.ref,
    title: input.title,
    filename,
    folderId: input.folderId,
    request: input.request,
    render: ({ marking }) => {
      stored = stampAgentFile(checked, provenance, marking)
      return { bytes: stored, contentType: checked.contentType, marking }
    },
    origin: {
      conversationId: input.originConversationId ?? null,
      locale: input.locale ?? AGENT_REFUSAL_LOCALE,
    },
  })

  return recordGeneratedDraft(input, filed, contentDigest(stored ?? input.bytes))
}

export function renderAgentFileVersion(
  document: Document,
  version: DocumentVersion,
  file: AgentFileUpload,
): RenderedVersionBytes {
  if (document.authoredBy === 'user' || document.authoredByProducer !== AGENT_FILE_PRODUCER) {
    throw new ConflictError('Only a file the agent filed with create_file can be replaced with update_file', {
      producer: document.authoredByProducer,
    })
  }
  const checked = checkAgentFile(file.bytes, file.contentType)
  const current = normalizeContentType(version.contentType ?? document.contentType ?? '')
  if (checked.contentType !== current) {
    throw refuse('not-the-declared-type', `this draft is ${current}; file a ${checked.contentType} as a new document`)
  }
  const ref = document.authoredByRef ?? document.id
  const marking = generatedDocumentMarking(AGENT_FILE_PRODUCER, ref)
  const bytes = Buffer.from(stampAgentFile(checked, generatedDocumentProvenance(AGENT_FILE_PRODUCER, ref), marking))
  if (!markingIsInBytes(bytes, marking)) throw new UnmarkedRenderingError(AGENT_FILE_PRODUCER, checked.contentType)
  return { bytes, contentType: checked.contentType, contentHash: contentDigest(bytes) }
}

export async function replaceAgentFileVersion(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  file: AgentFileUpload,
  ifMatch: string,
  options: ReplaceVersionOptions,
): Promise<DocumentVersion> {
  return replaceVersionFile(session, documentId, versionId, ifMatch, options, async (document, version) =>
    renderAgentFileVersion(document, version, file),
  )
}
