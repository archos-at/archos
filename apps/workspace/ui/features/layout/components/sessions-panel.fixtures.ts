import { vi } from 'vitest'
import type { JobRun } from '@/adapters/api/jobs-client'
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

export const makeLedgerRun = (overrides: Partial<JobRun> = {}): JobRun => ({
  id: 'run-1',
  taskId: null,
  kind: 'deep-research',
  title: 'Brandschutz Tiefgarage',
  goal: null,
  status: 'succeeded',
  review: null,
  reviewReason: null,
  filedDocumentId: null,
  conversationId: 'conv-1',
  runMessageId: 'msg-1',
  trigger: 'delegated',
  requesterUserId: 'user_1',
  requesterName: null,
  createdAt: new Date().toISOString(),
  finishedAt: null,
  error: null,
  ...overrides,
})
