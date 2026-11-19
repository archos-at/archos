import type { InboundMailPartView, InboundMailSenderView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'

export interface SenderFolderPick {
  folderId: string
  path: string
  count: number
  reason: string
}

/** Built from `inboundMailCopy`: `t('senderMemory.pick', { count, name })` and `t('senderMemory.suggestion', { name })`. */
export interface SenderMemoryCopy {
  pick: (count: number, name: string) => string
  suggestion: (name: string) => string
}

export function senderMemoryName(sender: Pick<InboundMailSenderView, 'name' | 'address'> | null): string | null {
  if (!sender) return null
  return sender.name?.trim() || sender.address.trim() || null
}

export function senderFolderPicks(
  view: Pick<InboundMailView, 'senderFolders' | 'sender'>,
  copy: Pick<SenderMemoryCopy, 'pick'>,
  options: { writable?: (folderId: string) => boolean } = {},
): SenderFolderPick[] {
  const name = senderMemoryName(view.sender)
  if (!name) return []
  return view.senderFolders
    .filter((folder) => options.writable?.(folder.folderId) ?? true)
    .map((folder) => ({ folderId: folder.folderId, path: folder.path, count: folder.count, reason: copy.pick(folder.count, name) }))
}

export function senderMemoryReason(
  view: Pick<InboundMailView, 'sender'>,
  part: Pick<InboundMailPartView, 'suggestion'>,
  copy: Pick<SenderMemoryCopy, 'suggestion'>,
): string | null {
  const name = senderMemoryName(view.sender)
  return part.suggestion?.source === 'sender_memory' && name ? copy.suggestion(name) : null
}
