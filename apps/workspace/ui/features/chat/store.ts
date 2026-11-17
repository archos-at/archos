import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { ChatStore } from './types'

export type ChatStoreWithHydration = ChatStore & {
  hasHydrated: boolean
}
import { createMessagesSlice } from './stores/messages-store'
import { createSessionsSlice } from './stores/sessions-store'
import { createInteractionSlice } from './stores/interaction-store'
import { chatIndexKey, createResilientStorage } from './stores/chat-storage'
import { moveStoredChat } from './stores/chat-storage-rename'
import {
  logStoreHydration,
  logExternalStorageEvent,
} from './lib/storage-logger'

const CHAT_STORE_NAME = 'chat-store'
const LEGACY_CHAT_STORE_NAME = 'aiq-chat-store'

const chatStorage = () => {
  if (typeof window === 'undefined') return undefined
  try {
    moveStoredChat(LEGACY_CHAT_STORE_NAME, CHAT_STORE_NAME)
  } catch {
    // No localStorage: createResilientStorage reports it and stores nothing.
  }
  return createResilientStorage()
}

export const useChatStore = create<ChatStoreWithHydration>()(
  devtools(
    persist(
      (set, get, store) => ({
        ...createMessagesSlice(set, get, store),
        ...createSessionsSlice(set, get, store),
        ...createInteractionSlice(set, get, store),
        hasHydrated: false,
      }),
      {
        name: CHAT_STORE_NAME,
        storage: chatStorage(),
        partialize: (state) => ({
          currentUserId: state.currentUserId,
          conversations: state.conversations,
          currentConversation: state.currentConversation,
          composerDrafts: state.composerDrafts,
        }),
        onRehydrateStorage: () => (state) => {
          useChatStore.setState({ hasHydrated: true })
          if (!state || typeof window === 'undefined') return
          queueMicrotask(() => {
            const store = useChatStore.getState()
            if (store.projectId) store.setProjectId(store.projectId)
          })
        },
      }
    ),
    { name: 'ChatStore' }
  )
)

export const selectHasRecoverableConnectionError = (state: ChatStore): boolean =>
  state.currentConversation?.messages.some(
    (m) =>
      m.messageType === 'error' &&
      m.errorData?.errorCode?.startsWith('connection.') &&
      m.errorData.errorCode !== 'connection.server_incompatible'
  ) ?? false

if (typeof window !== 'undefined') {
  const initialState = useChatStore.getState()
  logStoreHydration(true, initialState.conversations?.length ?? 0, initialState.currentUserId)

  window.addEventListener('storage', (event) => {
    if (event.key === chatIndexKey(CHAT_STORE_NAME)) {
      logExternalStorageEvent(event.key, event.oldValue, event.newValue)

      if (event.oldValue !== null && event.newValue === null) {
        console.error(
          '[SessionsStore] ❌ CRITICAL: Storage cleared by external source (browser extension, dev tools, or another tab)'
        )
      }
    }
  })
}
