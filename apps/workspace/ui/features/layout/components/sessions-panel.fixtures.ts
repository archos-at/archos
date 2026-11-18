import { vi } from 'vitest'
import { useChatStore, type ChatStoreWithHydration } from '@/features/chat/store'
import { asStoreState, type StoreSelector } from '@/test-utils/store-fixtures'

const createMockChatState = (overrides: { hasAnyBusySession?: () => boolean } = {}) => ({
  hasAnyBusySession: overrides.hasAnyBusySession ?? (() => false),
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
