import 'server-only'
import { ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import type { KnowledgeProvenance } from '@/lib/db/schema/knowledge-records'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import {
  uploadOfficeShelfDocument,
  type OfficeShelfUploadInput,
  type UploadOfficeShelfDocumentResult,
} from '@/lib/office-shelf/service'
import { readCoverText } from '@/lib/pdf/cover-text'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import type { BaseKnowledgeEntry, ProposeEntryBody } from '../wire'
import { proposalReading, readCover, type CoverReading } from './cover-page'
import { keepAsOrdinaryFiles } from './folder-norms-repository'
import { isStandardsFolder, standardsFolderRows, standardsRoot } from './folders'
import { confirmedWorkOf } from './proposal-match'
import { recognizeNorm } from './reading'
import { readShelfDocument } from './repository'
import { recordProposal, storedEntryOf } from './service'
import { withholdText } from './text-effects'

const proposalBody = (documentId: string, designation: string | null) => (designation ? { documentId, designation } : { documentId })

async function coverOf(file: File): Promise<CoverReading | null> {
  const text = await readCoverText(file)
  return text ? readCover(text) : null
}

export interface NormIntakeInput extends OfficeShelfUploadInput {
  asNorm?: boolean
}

function keptAsOrdinary(session: AuthorizedSession, input: OfficeShelfUploadInput): OfficeShelfUploadInput {
  return {
    ...input,
    beforeDispatch: async (documentId) => {
      await input.beforeDispatch?.(documentId)
      await keepAsOrdinaryFiles(session.organizationId, [documentId], session.userId)
    },
  }
}

export async function uploadToOfficeShelf(
  session: AuthorizedSession,
  file: File,
  request: Request,
  { asNorm = false, ...input }: NormIntakeInput = {},
): Promise<UploadOfficeShelfDocumentResult> {
  if (!isOfficeStandardsEnabled(session) || !canManageOfficeShelf(session)) return uploadOfficeShelfDocument(session, file, request, input)
  const from = input.folderId ?? null
  const inStandards = async () => from !== null && (await isStandardsFolder(session, from))
  if (input.revisionOf) {
    return uploadOfficeShelfDocument(session, file, request, (await inStandards()) ? input : keptAsOrdinary(session, input))
  }
  const reading = recognizeNorm({ fileName: file.name })
  if (!reading.norm && (!asNorm || reading.platformHeld)) return uploadOfficeShelfDocument(session, file, request, input)
  const standing = await inStandards()
  if (standing && !asNorm) return uploadOfficeShelfDocument(session, file, request, input)
  const [root, entries, cover] = await Promise.all([standardsRoot(session.organizationId), readOfficeEntries(session.organizationId), coverOf(file)])
  const read = proposalReading(file.name, reading.norm ? reading.designation : null, cover)
  const designation = read.values.designation ?? null
  return uploadOfficeShelfDocument(session, file, request, {
    ...input,
    folderId: standing ? from : root.id,
    beforeDispatch: async (documentId) => {
      const body: ProposeEntryBody = { documentId, ...read.values }
      await recordProposal(session, body, file.name, 'reading', confirmedWorkOf(entries, designation), {
        filedFrom: { folderId: standing ? null : from, upload: true },
        ...(read.cover ? { cover: read.cover } : {}),
      })
    },
  })
}

export interface NormCandidate {
  documentId: string
  fileName: string
  folderId: string | null
  designation: string | null
}

export interface NormPlace {
  rootId: string
  entries: readonly StoredEntry[]
  standards: ReadonlySet<string>
}

export interface NormProposer {
  body?: ProposeEntryBody
  proposedBy?: KnowledgeProvenance['proposedBy']
}

export async function takeAsNorm(
  session: AuthorizedSession,
  candidate: NormCandidate,
  { rootId, entries, standards }: NormPlace,
  { body, proposedBy = 'reading' }: NormProposer = {},
): Promise<string> {
  const { documentId, fileName, folderId, designation } = candidate
  const inStandards = folderId !== null && standards.has(folderId)
  const entryId = await recordProposal(
    session,
    body ?? proposalBody(documentId, designation),
    fileName,
    proposedBy,
    confirmedWorkOf(entries, designation),
    inStandards ? {} : { filedFrom: { folderId } },
  )
  await withholdText(session, documentId)
  if (inStandards) return entryId
  const moved = await moveDocumentToFolder({ documentId, folderId: rootId, expectedFolderId: folderId }, session)
  if (!moved.ok) throw new UnprocessableError(moved.error)
  return entryId
}

export async function proposeBaseKnowledge(
  session: AuthorizedSession,
  body: ProposeEntryBody,
  proposedBy: KnowledgeProvenance['proposedBy'] = 'reading',
): Promise<BaseKnowledgeEntry> {
  if (!canManageOfficeShelf(session)) throw new ForbiddenError()
  const organizationId = session.organizationId
  const document = await readShelfDocument(organizationId, body.documentId, await shelfReaderFor(session, { scope: 'office_shelf', projectId: null }))
  if (!document) throw new NotFoundError('No Archiv document with this id; list the Archiv first.')
  const [root, entries, { folders }] = await Promise.all([standardsRoot(organizationId), readOfficeEntries(organizationId), standardsFolderRows(session)])
  const reading = recognizeNorm({ fileName: document.fileName })
  const designation = body.designation ?? (reading.norm ? reading.designation : null)
  const place = { rootId: root.id, entries, standards: new Set([root.id, ...folders.map((folder) => folder.id)]) }
  const entryId = await takeAsNorm(session, { documentId: document.id, fileName: document.fileName, folderId: document.folderId, designation }, place, { body, proposedBy })
  return (await storedEntryOf(session, entryId)).entry
}
