import { vi } from 'vitest'
import { useChatStore, type ChatStoreWithHydration } from '@/features/chat/store'
import { asStoreState, type StoreSelector } from '@/test-utils/store-fixtures'

const createMockChatState = (
  overrides: {
    isSessionBusy?: (sessionId: string) => boolean
    hasAnyBusySession?: () => boolean
    isStreaming?: boolean
    pendingInteraction?: { turnId: string; interactionId: string; input: 'text' | 'choice' } | null
  } = {}
) => ({
  isSessionBusy: overrides.isSessionBusy ?? (() => false),
  hasAnyBusySession: overrides.hasAnyBusySession ?? (() => false),
  isStreaming: overrides.isStreaming ?? false,
  pendingInteraction: overrides.pendingInteraction ?? null,
})

export const setupChatStoreMock = (overrides: Parameters<typeof createMockChatState>[0] = {}) => {
  const state = createMockChatState(overrides)
  vi.mocked(useChatStore).mockImplementation((selector: StoreSelector<ChatStoreWithHydration>) => {
    if (typeof selector === 'function') {
      return selector(asStoreState<ChatStoreWithHydration>(state))
    }
    return undefined
  })
}

export const rowOf = (element: HTMLElement): HTMLElement => {
  const row = element.closest('li')
  if (!row) throw new Error('expected the element to sit inside a list row')
  return row
}
