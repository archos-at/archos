import { create } from 'zustand'
import type { AnswerCard } from '@/shared/cards/schemas'

export interface DraftLife {
  version: number
  previousVersion: number | null
  removed: boolean
}

interface DraftLifeState {
  changes: Record<string, Partial<DraftLife>>
  record: (conversationId: string, path: string, change: Partial<DraftLife>) => void
}

export const draftLifeKey = (conversationId: string, path: string): string => `${conversationId}\u0000${path}`

export const useDraftLifeStore = create<DraftLifeState>()((set) => ({
  changes: {},
  record: (conversationId, path, change) =>
    set((state) => {
      const key = draftLifeKey(conversationId, path)
      return { changes: { ...state.changes, [key]: { ...state.changes[key], ...change } } }
    }),
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
  if (!newest) return null
  return {
    version: newest.version,
    previousVersion: newest.previous_version ?? null,
    removed: newest.removed === true,
  }
}

export function mergedDraftLife(
  own: DraftLife,
  newest: DraftLife | null,
  change: Partial<DraftLife> | undefined,
): DraftLife {
  const base = newest && newest.version > own.version ? newest : own
  const removed = (newest?.removed ?? false) || own.removed
  return {
    version: change?.version ?? base.version,
    previousVersion: change?.previousVersion !== undefined ? change.previousVersion : base.previousVersion,
    removed: change?.removed ?? removed,
  }
}

export type DraftLifeFetch = (path: string, init?: RequestInit) => Promise<Response>

const draftUrl = (conversationId: string, route: '' | '/restore', path: string): string =>
  `/api/conversations/${encodeURIComponent(conversationId)}/draft${route}?path=${encodeURIComponent(path)}`

export async function deleteDraft(conversationId: string, path: string, run: DraftLifeFetch = fetch): Promise<void> {
  const response = await run(draftUrl(conversationId, '', path), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error(`Deleting the draft failed with ${response.status}`)
}

export async function restoreDraft(conversationId: string, path: string, run: DraftLifeFetch = fetch): Promise<number> {
  const response = await run(draftUrl(conversationId, '/restore', path), { method: 'POST' })
  const body: unknown = await response.json().catch(() => null)
  const version = typeof body === 'object' && body !== null && 'version' in body ? Number(body.version) : NaN
  if (!response.ok || !Number.isInteger(version)) throw new Error(`Restoring the draft failed with ${response.status}`)
  return version
}
