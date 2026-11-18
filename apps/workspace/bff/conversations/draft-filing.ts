import 'server-only'
import { createHash } from 'node:crypto'
import { BadRequestError, ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { fileAgentDocumentDraft } from '@/lib/documents/agent-document'
import { documentDisplayName, validateDocumentName } from '@/lib/documents/display-name'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { findDocumentAuthoredByRef, listProjectDocuments, DOCUMENT_LIST_LIMIT } from '@/lib/documents/repository'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import type { DocumentListRow } from '@/lib/documents/repository'
import { findOpenVersion } from '@/lib/documents/version-repository'
import { findConversationInOrg } from './repository'
import { readConversationDraft } from './draft-preview'
import { readConversationDraftBytes } from './draft-file'
import { draftFileType, filedExtension, type DraftFileType } from './draft-media'
import { fileAgentFileDraft } from '@/lib/documents/agent-file'
import { REFUSED_AGENT_FILE_TYPES } from '@/lib/documents/agent-file-types'
import { findProjectFolder } from '@/lib/projects/folder-service'
import type { FiledAgentDocumentDraft } from '@/lib/documents/agent-document'
import type { Locale } from '@/i18n/config'

export const MAX_FILING_REF_CHARS = 200
export const MAX_FILING_TITLE_CHARS = 200

function filingSlug(path: string): string {
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
  const stem = name.replace(/\.md$/i, '')
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'draft'
}

export function normalizeDraftPath(path: string): string {
  return path.trim().replace(/^\/+/, '')
}

function filingHash(conversationId: string, path: string): string {
  return createHash('sha256').update(`${conversationId}\0${path}`).digest('hex').slice(0, 8)
}

export function filingReference(conversationId: string, path: string): string {
  const normalized = normalizeDraftPath(path)
  const raw = `${conversationId}-${filingSlug(normalized)}`
  if (raw.length <= MAX_FILING_REF_CHARS) return raw
  const suffix = `-${filingHash(conversationId, normalized)}`
  return `${raw.slice(0, MAX_FILING_REF_CHARS - suffix.length)}${suffix}`
}

function sameTitle(a: string, b: string): boolean {
  const key = (value: string): string => value.normalize('NFC').trim().toLowerCase()
  return key(a) === key(b)
}

function fallbackTitle(path: string): string {
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
  return name.trim() || 'Entwurf'
}

// eslint-disable-next-line no-control-regex -- control characters are what the name loses
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f]/g

export function filingName(input: string, extension: string): string {
  const cleaned = input.replace(UNSAFE_NAME_CHARACTERS, '').replace(/[/\\]+/g, '-').replace(/\s+/g, ' ').trim()
  const suffix = `.${extension}`
  const stem = (cleaned.toLowerCase().endsWith(suffix) ? cleaned.slice(0, -suffix.length) : cleaned)
    .replace(/^[.\s]+/, '')
    .trim()
  const validated = validateDocumentName(stem === '' ? '' : `${stem}${suffix}`)
  if (!validated.ok) throw new BadRequestError('The file name is not usable', { reason: 'invalid-name', name: validated.reason })
  return validated.value
}

type Destination = { kind: 'default' } | { kind: 'chosen'; folderId: string | null }

async function findSameTitleDocument(
  projectId: string,
  organizationId: string,
  title: string,
  destination: Destination,
): Promise<DocumentListRow | null> {
  let offset = 0
  for (;;) {
    const rows = await listProjectDocuments(projectId, organizationId, {
      limit: DOCUMENT_LIST_LIMIT,
      offset,
      reader: SCREENED_ONLY,
    })
    const clash = rows.find(
      (row) =>
        (destination.kind === 'default' || row.folderId === destination.folderId) &&
        sameTitle(documentDisplayName(row), title),
    )
    if (clash) return clash
    if (rows.length < DOCUMENT_LIST_LIMIT) return null
    offset += rows.length
  }
}

export interface FileConversationDraftInput {
  path: string
  title?: string
  name?: string
  folderId?: string | null
  force?: boolean
  locale?: Locale
}

export interface FiledConversationDraft {
  documentId: string
  versionId: string
  state: DocumentVersionState
  alreadyFiled: boolean
  folderId: string | null
  folderName: string | null
}

async function folderNameOf(projectId: string, organizationId: string, folderId: string | null): Promise<string | null> {
  if (folderId === null) return null
  return (await findProjectFolder(projectId, folderId, organizationId))?.name ?? null
}

function refuseUnfileable(type: DraftFileType): void {
  if (type.filing !== 'refused') return
  throw new UnprocessableError(
    REFUSED_AGENT_FILE_TYPES[type.contentType] ??
      'Only Word, Excel, PowerPoint, PDF, SVG, PNG and Markdown drafts can be filed into the project.',
    { reason: 'not-fileable', format: type.format, extension: type.extension },
  )
}

interface FilingTarget {
  session: AuthorizedSession
  conversationId: string
  projectId: string
  path: string
  ref: string
  title: string
  folderId?: string | null
  request?: Request
  locale?: Locale
}

async function fileDraftContent(target: FilingTarget, type: DraftFileType): Promise<FiledAgentDocumentDraft> {
  const common = {
    session: target.session,
    projectId: target.projectId,
    ref: target.ref,
    title: target.title,
    folderId: target.folderId,
    request: target.request,
    originConversationId: target.conversationId,
    locale: target.locale,
  }
  if (type.filing === 'file') {
    const draft = await readConversationDraftBytes(target.session, target.conversationId, target.path)
    return fileAgentFileDraft({ ...common, filename: draft.filename, contentType: type.contentType, bytes: draft.bytes })
  }
  const draft = await readConversationDraft(target.session, target.conversationId, target.path)
  if (draft.encoding !== 'utf-8') {
    throw new UnprocessableError('This draft is not text and has no file type that can be filed', {
      reason: 'not-fileable',
      format: type.format,
      extension: type.extension,
    })
  }
  return fileAgentDocumentDraft({ ...common, content: draft.content })
}

export async function fileConversationDraft(
  session: AuthorizedSession,
  conversationId: string,
  input: FileConversationDraftInput,
  request?: Request,
): Promise<FiledConversationDraft> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')

  const conversation = await findConversationInOrg(conversationId, session.organizationId)
  if (!conversation) throw new NotFoundError()
  if (!conversation.projectId) {
    throw new UnprocessableError('This conversation has no project to file into')
  }
  const projectId = conversation.projectId

  const path = normalizeDraftPath(input.path)
  const type = draftFileType(path)
  refuseUnfileable(type)

  const title =
    input.name === undefined ? (input.title ?? '').trim() || fallbackTitle(path) : filingName(input.name, filedExtension(type))
  const destination: Destination =
    input.folderId === undefined ? { kind: 'default' } : { kind: 'chosen', folderId: input.folderId }
  if (title.length > MAX_FILING_TITLE_CHARS) {
    throw new BadRequestError('Title is too long')
  }
  const ref = filingReference(conversationId, path)

  const refHit = await findDocumentAuthoredByRef(ref, session.organizationId, projectId, 'agent_document')
  if (refHit) {
    const open = await findOpenVersion(refHit.id, session.organizationId)
    if (open && (open.state === 'draft' || open.state === 'changes_requested')) {
      return {
        documentId: refHit.id,
        versionId: open.id,
        state: open.state,
        alreadyFiled: true,
        folderId: refHit.folderId,
        folderName: await folderNameOf(projectId, session.organizationId, refHit.folderId),
      }
    }
    throw new ConflictError('This draft has already been filed and is no longer a draft', {
      reason: 'already-submitted',
    })
  }

  if (!input.force) {
    const clash = await findSameTitleDocument(projectId, session.organizationId, title, destination)
    if (clash) {
      throw new ConflictError('A document with this title is already in the project', {
        reason: 'same-name',
        documentId: clash.id,
        displayName: documentDisplayName(clash),
      })
    }
  }

  const filed = await fileDraftContent(
    { session, conversationId, projectId, path, ref, title, folderId: input.folderId, request, locale: input.locale },
    type,
  )
  return {
    documentId: filed.documentId,
    versionId: filed.version.id,
    state: filed.version.state,
    alreadyFiled: filed.alreadyFiled,
    folderId: filed.folderId,
    folderName: await folderNameOf(projectId, session.organizationId, filed.folderId),
  }
}
