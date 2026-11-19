import 'server-only'
import { UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import {
  uploadOfficeShelfDocument,
  type OfficeShelfUploadInput,
  type UploadOfficeShelfDocumentResult,
} from '@/lib/office-shelf/service'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import { isStandardsFolder, standardsRoot } from './folders'
import { confirmedWorkOf } from './proposal-match'
import { recognizeNorm } from './reading'
import { recordProposal } from './service'
import { withholdText } from './text-effects'

const proposalBody = (documentId: string, designation: string | null) => (designation ? { documentId, designation } : { documentId })

export async function uploadToOfficeShelf(
  session: AuthorizedSession,
  file: File,
  request: Request,
  input: OfficeShelfUploadInput = {},
): Promise<UploadOfficeShelfDocumentResult> {
  const from = input.folderId ?? null
  const reading = isOfficeStandardsEnabled(session) && canManageOfficeShelf(session) && !input.revisionOf ? recognizeNorm({ fileName: file.name }) : null
  if (!reading?.norm || (from && (await isStandardsFolder(session, from)))) return uploadOfficeShelfDocument(session, file, request, input)
  const [root, entries] = await Promise.all([standardsRoot(session.organizationId), readOfficeEntries(session.organizationId)])
  const { designation } = reading
  return uploadOfficeShelfDocument(session, file, request, {
    ...input,
    folderId: root.id,
    beforeDispatch: async (documentId) => {
      await recordProposal(session, proposalBody(documentId, designation), file.name, 'reading', confirmedWorkOf(entries, designation), {
        filedFrom: { folderId: from },
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

export async function takeAsNorm(
  session: AuthorizedSession,
  candidate: NormCandidate,
  { rootId, entries, standards }: { rootId: string; entries: readonly StoredEntry[]; standards: ReadonlySet<string> },
): Promise<void> {
  const { documentId, fileName, folderId, designation } = candidate
  const inStandards = folderId !== null && standards.has(folderId)
  await recordProposal(
    session,
    proposalBody(documentId, designation),
    fileName,
    'reading',
    confirmedWorkOf(entries, designation),
    inStandards ? {} : { filedFrom: { folderId } },
  )
  await withholdText(session, documentId)
  if (inStandards) return
  const moved = await moveDocumentToFolder({ documentId, folderId: rootId, expectedFolderId: folderId }, session)
  if (!moved.ok) throw new UnprocessableError(moved.error)
}
