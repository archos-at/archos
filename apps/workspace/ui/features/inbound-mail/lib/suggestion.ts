import { DOCUMENT_TYPE_TAGS, type DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import { INBOUND_MAIL_FILE_NAME_MAX, INBOUND_MAIL_FOLDER_PATH_MAX, type InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { suggestionSkipReason } from '@/lib/inbound-mail/suggest'

export interface PartSuggestion {
  folder: string | null
  folderId: string | null
  isNew: boolean
  documentType: DocumentTypeTag | null
  name: string | null
  reason: string | null
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value.trim() : null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readSuggestion(raw: Record<string, unknown> | null | undefined): PartSuggestion | null {
  if (!raw || typeof raw !== 'object') return null
  const folderValue = raw.folder ?? raw.folderPath
  const folder = folderValue === '' ? '' : text(folderValue, INBOUND_MAIL_FOLDER_PATH_MAX)
  const folderId = typeof raw.folderId === 'string' && UUID.test(raw.folderId) ? raw.folderId : null
  const typeValue = raw.documentType ?? raw.type
  const documentType =
    typeof typeValue === 'string' && (DOCUMENT_TYPE_TAGS as readonly string[]).includes(typeValue)
      ? (typeValue as DocumentTypeTag)
      : null
  const name = text(raw.name, INBOUND_MAIL_FILE_NAME_MAX)
  const reason = text(raw.reason, 500)
  if (folder === null && documentType === null && name === null) return null
  return {
    folder,
    folderId,
    isNew: raw.newFolder === true || raw.new === true || raw.isNew === true,
    documentType,
    name,
    reason,
  }
}

export function folderLeaf(path: string): string {
  const parts = path.split('/').filter((part) => part.trim() !== '')
  return parts.length > 0 ? parts[parts.length - 1] : path
}

export const SUGGESTION_GRACE_MS = 10 * 60 * 1000

export function missingSuggestionReason(
  mail: Pick<InboundMailView, 'automatic' | 'sender' | 'receivedAt'>,
  now: number = Date.now(),
): 'pending' | 'skipped' | 'none' {
  const skip = suggestionSkipReason({
    status: 'waiting',
    senderTrust: mail.sender?.trust ?? null,
    senderReason: mail.sender?.reason ?? null,
    senderFlags: mail.sender?.flags ?? [],
    automatic: mail.automatic,
  })
  if (skip !== null && skip !== 'not_waiting') return 'skipped'
  return now - Date.parse(mail.receivedAt) < SUGGESTION_GRACE_MS ? 'pending' : 'none'
}

export function mailStillSettling(
  mail: Pick<InboundMailView, 'status' | 'rawScan' | 'parts' | 'automatic' | 'sender' | 'receivedAt'>,
  now: number = Date.now(),
): boolean {
  if (mail.status !== 'waiting') return false
  const waiting = mail.parts.filter((part) => part.state === 'waiting')
  if (waiting.length === 0) return false
  if (mail.rawScan === 'pending' || mail.rawScan === 'failed') return true
  const attachments = waiting.filter((part) => part.kind === 'attachment' && part.offered)
  if (attachments.some((part) => part.scan === 'pending' || part.scan === 'failed')) return true
  return (
    missingSuggestionReason(mail, now) === 'pending' &&
    attachments.some((part) => part.scan === 'clean' && part.revisionCandidate === null && readSuggestion(part.suggestion) === null)
  )
}
