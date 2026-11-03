import 'server-only'
/**
 * What a mail's entry records of what came with it (D36), and who may see
 * where an attachment went (RT-S13). Pure; `./append.ts` files the rows.
 */

import type { AccessFolder } from '@/lib/authz/folder-access-rule'
import type { InboundMailDecisionRow, InboundMailPartRow } from '@/lib/db/schema/inbound-mail'
import type { MailThreadEntryAttachmentRow, NewMailThreadEntryAttachmentRow } from '@/lib/db/schema/mail-thread'
import { documentNameKey } from '@/lib/documents/name-match'
import type { InboundMailNotStaged, NotStagedReason } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { MailThreadAttachmentNotFiledReason, MailThreadSectionAttachment } from './mail-thread-wire'
import { sectionAttachment } from './render'

// ---------------------------------------------------------------------------
// Who may see where an attachment went (RT-S13)
// ---------------------------------------------------------------------------

/** The folders at or above `folderId` whose own list narrows who READS it (ADR-0088). */
export function readRestrictionsAt(
  tree: ReadonlyMap<string, AccessFolder>,
  folderId: string | null
): Set<string> {
  const found = new Set<string>()
  const seen = new Set<string>()
  for (let current = folderId ? tree.get(folderId) : undefined; current && !seen.has(current.id);) {
    seen.add(current.id)
    if (current.accessMode === 'custom' && !current.everyoneReads) found.add(current.id)
    current = current.parentId ? tree.get(current.parentId) : undefined
  }
  return found
}

/**
 * Whether everyone who may read the thread document may read a document in
 * `folderId`: every list that narrows the attachment's folder narrows the
 * thread's too. A folder that is gone answers no: nothing is named on a guess.
 */
export function readableWithThread(
  tree: ReadonlyMap<string, AccessFolder>,
  folderId: string | null,
  threadFolderId: string | null
): boolean {
  if (folderId && !tree.has(folderId)) return false
  const thread = readRestrictionsAt(tree, threadFolderId)
  return [...readRestrictionsAt(tree, folderId)].every((id) => thread.has(id))
}

// ---------------------------------------------------------------------------
// What came with the message (D36)
// ---------------------------------------------------------------------------

/** One attachment part as the entry records it: the part, its decision, and the document it is now. */
export interface AttachmentFact {
  part: InboundMailPartRow
  decision: InboundMailDecisionRow | null
  /** The document the part was filed as, as the filer may read it now; null when it is not one, or gone. */
  document: {
    id: string
    versionId: string | null
    versionCreatedAt: Date | null
    folderId: string | null
  } | null
}

/** The never-staged files a mail carried that somebody sent (a layout image, a signature, a TNEF box or an invitation is not one). */
const SENT_FILE_REASONS: ReadonlySet<NotStagedReason> = new Set([
  'encrypted',
  'archive',
  'size',
  'limit',
  'empty',
])

/** Why a part that is no document was not filed. */
function notFiledReasonOf(part: InboundMailPartRow): MailThreadAttachmentNotFiledReason {
  if (part.state === 'waiting' || part.state === 'filing') return 'pending'
  if (part.riskFlags.includes('type_not_accepted')) return 'type_not_accepted'
  if (part.scanStatus === 'infected') return 'infected'
  if (part.scanStatus !== 'clean') return 'scan_failed'
  return part.state === 'expired' ? 'expired' : 'dismissed'
}

export const cut = (value: string | null, max: number): string | null =>
  value ? value.slice(0, max) : null

/**
 * One row per attachment of the mail, whatever became of it (D36), with what
 * the thread's section prints for it frozen in ({@link sectionAttachment}).
 * Pure. A Fassung that was the document's before this mail arrived is
 * `already_present`: the upload found the same bytes. A dismissed duplicate of
 * a project document is `already_present` as that document, never named.
 */
export function attachmentRowsOf(input: {
  entryId: string
  organizationId: string
  projectId: string
  receivedAt: Date
  facts: readonly AttachmentFact[]
  notStaged: readonly InboundMailNotStaged[]
  /** Whether a document in this folder is readable by everyone who reads the thread. */
  visibleWithThread: (folderId: string | null) => boolean
}): NewMailThreadEntryAttachmentRow[] {
  const base = {
    organizationId: input.organizationId,
    projectId: input.projectId,
    entryId: input.entryId,
  }
  const rows: NewMailThreadEntryAttachmentRow[] = []
  for (const { part, decision, document } of input.facts) {
    const filename = cut(
      part.filename ?? (decision?.fileName ? documentNameKey(decision.fileName) : null),
      500
    )
    if (part.state === 'filed') {
      const present = Boolean(
        document?.versionCreatedAt && document.versionCreatedAt < input.receivedAt
      )
      const disposition = present ? 'already_present' : 'filed'
      const section = sectionAttachment({
        disposition,
        name: decision?.fileName ? documentNameKey(decision.fileName) : null,
        folderPath: decision?.folderPath ?? null,
        visibleWithThread: document !== null && input.visibleWithThread(document.folderId),
        nameReleased: decision?.screeningRelease ?? false,
      })
      rows.push({
        ...base,
        position: part.position,
        filename,
        disposition,
        notFiledReason: null,
        documentId: part.documentId,
        documentVersionId: part.documentId ? part.documentVersionId : null,
        sectionName: section.name,
        sectionFolderPath: section.folderPath,
      })
      continue
    }
    if (
      part.duplicateOfDocumentId &&
      (part.state === 'dismissed' || part.state === 'expired') &&
      document
    ) {
      rows.push({
        ...base,
        position: part.position,
        filename,
        disposition: 'already_present',
        notFiledReason: null,
        documentId: document.id,
        documentVersionId: document.versionId,
        sectionName: null,
        sectionFolderPath: null,
      })
      continue
    }
    rows.push({
      ...base,
      position: part.position,
      filename,
      disposition: 'not_filed',
      notFiledReason: notFiledReasonOf(part),
    })
  }
  let next = Math.max(0, ...input.facts.map((fact) => fact.part.position)) + 1
  for (const item of input.notStaged) {
    if (!SENT_FILE_REASONS.has(item.reason)) continue
    rows.push({
      ...base,
      position: next++,
      filename: cut(item.filename || null, 500),
      disposition: 'not_filed',
      notFiledReason: item.reason as MailThreadAttachmentNotFiledReason,
    })
  }
  return rows
}

/** What a section prints for a stored attachment row. */
export const sectionLineOf = (
  row: Pick<MailThreadEntryAttachmentRow, 'sectionName' | 'sectionFolderPath'>
): MailThreadSectionAttachment => ({
  name: row.sectionName,
  folderPath: row.sectionFolderPath,
})
