import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { DEFAULT_CHAT_EFFORT, isChatEffort, type ChatEffort } from '@/lib/reasoning-settings/catalog'

const MAX_REMEMBERED = 200

interface EffortState {
  orgDefault: ChatEffort
  draft: ChatEffort | null
  byConversation: Record<string, ChatEffort>
  setOrgDefault: (effort: ChatEffort) => void
  choose: (conversationId: string | null | undefined, effort: ChatEffort) => void
  levelForSend: (conversationId: string | null | undefined) => ChatEffort
}

export function effectiveEffort(
  state: Pick<EffortState, 'orgDefault' | 'draft' | 'byConversation'>,
  conversationId: string | null | undefined
): ChatEffort {
  const own = conversationId ? state.byConversation[conversationId] : undefined
  return own ?? state.draft ?? state.orgDefault
}

function remember(
  byConversation: Record<string, ChatEffort>,
  conversationId: string,
  effort: ChatEffort
): Record<string, ChatEffort> {
  const { [conversationId]: _previous, ...rest } = byConversation
  const entries = Object.entries(rest)
  const kept = entries.length >= MAX_REMEMBERED ? entries.slice(entries.length - MAX_REMEMBERED + 1) : entries
  return { ...Object.fromEntries(kept), [conversationId]: effort }
}

export const useEffortStore = create<EffortState>()(
  persist(
    (set, get) => ({
      orgDefault: DEFAULT_CHAT_EFFORT,
      draft: null,
      byConversation: {},
      setOrgDefault: (effort) => set({ orgDefault: effort }),
      choose: (conversationId, effort) =>
        set((state) =>
          conversationId
            ? { byConversation: remember(state.byConversation, conversationId, effort) }
            : { draft: effort }
        ),
      levelForSend: (conversationId) => {
        const state = get()
        const level = effectiveEffort(state, conversationId)
        if (conversationId && state.draft && !state.byConversation[conversationId]) {
          set({ draft: null, byConversation: remember(state.byConversation, conversationId, level) })
        }
        return level
      },
    }),
    {
      name: 'chat-effort',
      version: 1,
      partialize: (state) => ({ draft: state.draft, byConversation: state.byConversation }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<EffortState>
        const byConversation = Object.fromEntries(
          Object.entries(stored.byConversation ?? {}).filter(([, value]) => isChatEffort(value))
        ) as Record<string, ChatEffort>
        return {
          ...current,
          draft: isChatEffort(stored.draft) ? stored.draft : null,
          byConversation,
        }
      },
    }
  )
)
