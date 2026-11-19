import type { InboundMailFiledAsView, InboundMailSuggestedPlacesView, InboundMailView } from './inbound-mail-wire'
import { defaultThread } from './review-defaults'

export function suggestedPlaces(view: Pick<InboundMailView, 'status' | 'parts' | 'threadCandidates'>): InboundMailSuggestedPlacesView | null {
  if (view.status !== 'waiting') return null
  const message = view.parts.find((part) => part.kind === 'message' && part.state === 'waiting' && part.preselected)
  const thread = message ? defaultThread(view) : null
  const files = view.parts.filter((part) => part.kind === 'attachment' && part.state === 'waiting' && part.preselected)
  const folders = new Set<string>()
  for (const file of files) {
    const folder = file.revisionCandidate ? (file.revisionCandidate.folderPath ?? '') : (file.suggestion?.folderPath ?? null)
    if (folder !== null) folders.add(folder)
  }
  if (!message && files.length === 0) return null
  return {
    text: !message ? null : thread ? { kind: 'thread', name: thread.name } : { kind: 'new_thread' },
    files: files.length,
    folders: [...folders],
  }
}

export function filedTo(view: Pick<InboundMailView, 'parts'>): InboundMailFiledAsView | null {
  const filed = view.parts.filter((part) => part.state === 'filed')
  const text = filed.find((part) => part.kind === 'message')
  return text?.filedAs ?? filed.map((part) => part.filedAs).find((place) => place !== null) ?? null
}
