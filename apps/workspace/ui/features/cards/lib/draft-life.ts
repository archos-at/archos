import { create } from 'zustand'
import type { AnswerCard } from '@/shared/cards/schemas'

export interface DraftLife {
  version: number
  removed: boolean
}

interface DraftLifeState {
  removed: Record<string, true>
  markRemoved: (conversationId: string, path: string) => void
}

export const draftLifeKey = (conversationId: string, path: string): string => `${conversationId}\u0000${path}`

export const useDraftLifeStore = create<DraftLifeState>()((set) => ({
  removed: {},
  markRemoved: (conversationId, path) =>
    set((state) => ({ removed: { ...state.removed, [draftLifeKey(conversationId, path)]: true } })),
}))

type DraftCard = Extract<AnswerCard, { type: 'document_draft' }>

const isDraftCard = (card: AnswerCard | undefined): card is DraftCard => card?.type === 'document_draft'

export function newestDraftLife(
  messages: readonly { cards?: readonly (AnswerCard | undefined)[] }[],
  path: string,
): DraftLife | null {
  let newest: DraftCard | null = null
  for (const message of messages) {
    for (const card of message.cards ?? []) {
      if (isDraftCard(card) && card.path === path && (!newest || card.version >= newest.version)) newest = card
    }
  }
  return newest ? { version: newest.version, removed: newest.removed === true } : null
}

export type DraftLifeFetch = (path: string, init?: RequestInit) => Promise<Response>

export async function deleteDraft(conversationId: string, path: string, run: DraftLifeFetch = fetch): Promise<void> {
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/draft?path=${encodeURIComponent(path)}`
  const response = await run(url, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error(`Deleting the draft failed with ${response.status}`)
}
