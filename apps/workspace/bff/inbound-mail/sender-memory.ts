import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import type { InboundMailPartSuggestionView, InboundMailSenderFolderView } from './inbound-mail-wire'
import { attachmentsToPlace, suggestionSkipReason } from './suggest'

export const SENDER_FOLDERS_SHOWN = 4
export const SENDER_MEMORY_ENTRIES = 200
export const SENDER_MEMORY_MIN_FILES = 2
export const SENDER_MEMORY_LEAD = 2

export function senderMemoryAddress(
  mail: Pick<InboundMailRow, 'status' | 'senderAddress' | 'senderTrust' | 'senderReason' | 'senderFlags' | 'automatic'>,
): string | null {
  if (suggestionSkipReason(mail) !== null) return null
  const address = mail.senderAddress?.trim().toLowerCase() ?? ''
  return address.includes('@') ? address : null
}

export function dominantSenderFolder(folders: readonly InboundMailSenderFolderView[]): InboundMailSenderFolderView | null {
  const [top, next] = [...folders].sort((a, b) => b.count - a.count)
  if (!top || top.count < SENDER_MEMORY_MIN_FILES) return null
  return (next?.count ?? 0) * SENDER_MEMORY_LEAD <= top.count ? top : null
}

export function senderMemorySuggestion(folder: InboundMailSenderFolderView): InboundMailPartSuggestionView {
  return { folderId: folder.folderId, folderPath: folder.path, newFolder: false, documentType: null, reason: '', source: 'sender_memory' }
}

export type SenderMemoryFallback = (part: InboundMailPartRow) => InboundMailPartSuggestionView | null

export const NO_FALLBACK: SenderMemoryFallback = () => null

export function senderMemoryFallback(
  parts: readonly InboundMailPartRow[],
  folders: readonly InboundMailSenderFolderView[],
): SenderMemoryFallback {
  const folder = dominantSenderFolder(folders)
  if (!folder) return NO_FALLBACK
  const placeable = new Set(attachmentsToPlace(parts).map((part) => part.id))
  const suggestion = senderMemorySuggestion(folder)
  return (part) => (placeable.has(part.id) ? suggestion : null)
}

export const modelSuggestion = (suggestion: InboundMailPartSuggestionView | null): InboundMailPartSuggestionView | null =>
  suggestion?.source === 'sender_memory' ? null : suggestion
