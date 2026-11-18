import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { asStoreState, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStore } from '../types'

vi.mock('@/shared/hooks/use-backend-health', () => ({
  checkBackendHealthCached: vi.fn(),
  invalidateHealthCache: vi.fn(),
}))

import {
  checkBackendHealthCached,
  invalidateHealthCache,
} from '@/shared/hooks/use-backend-health'

const mockCheckHealth = checkBackendHealthCached as ReturnType<typeof vi.fn>
const mockInvalidateCache = invalidateHealthCache as ReturnType<typeof vi.fn>

vi.mock('../store', () => {
  const mockDismiss = vi.fn()
  let hasError = false

  return {
    useChatStore: vi.fn((selector: StoreSelector<ChatStore>) =>
      selector(
        asStoreState<ChatStore>({
          dismissConnectionErrors: mockDismiss,
          currentConversation: {
            id: 'conv-1',
            messages: hasError
              ? [
                  {
                    id: 'err-1',
                    messageType: 'error',
                    errorData: { errorCode: 'connection.failed' },
                  },
                ]
              : [],
          },
        }),
      ),
    ),
    selectHasRecoverableConnectionError: (state: ChatStore): boolean =>
      state.currentConversation?.messages.some(
        (m) =>
          m.messageType === 'error' &&
          m.errorData?.errorCode?.startsWith('connection.') &&
          m.errorData.errorCode !== 'connection.server_incompatible'
      ) ?? false,
    __setHasError: (val: boolean) => {
      hasError = val
    },
    __getMockDismiss: () => mockDismiss,
  }
})

type MockedStoreModule = typeof import('../store') & {
  __setHasError: (value: boolean) => void
  __getMockDismiss: () => ReturnType<typeof vi.fn>
}

const storeMock = (await import('../store')) as unknown as MockedStoreModule

import { useConnectionRecovery } from './use-connection-recovery'

describe('useConnectionRecovery', () => {
  const onRecovered = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    storeMock.__setHasError(false)
    mockCheckHealth.mockResolvedValue(false)
    vi.spyOn(Math, 'random').mockReturnValue(1)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does nothing when no connection errors exist', () => {
    storeMock.__setHasError(false)

    renderHook(() => useConnectionRecovery(onRecovered))

    vi.advanceTimersByTime(120_000)

    expect(mockCheckHealth).not.toHaveBeenCalled()
    expect(onRecovered).not.toHaveBeenCalled()
  })

  it('starts polling when connection error appears', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })

    expect(mockInvalidateCache).toHaveBeenCalled()
    expect(mockCheckHealth).toHaveBeenCalledTimes(1)
  })

  it('uses exponential backoff on repeated failures', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(20_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(3)
  })

  it('jitters the poll so clients that failed together do not poll together', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      vi.advanceTimersByTime(2_499)
    })
    expect(mockCheckHealth).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(1)
  })

  it('dismisses errors and calls onRecovered when health check succeeds', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(true)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })

    const mockDismiss = storeMock.__getMockDismiss()
    expect(mockDismiss).toHaveBeenCalled()
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('stops polling after successful recovery', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(true)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(1)
  })

  it('responds to browser online event', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(mockCheckHealth).toHaveBeenCalled()
  })

  it('responds to visibility change event', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockCheckHealth).toHaveBeenCalled()
  })

  it('cleans up timers and listeners on unmount', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    const { unmount } = renderHook(() => useConnectionRecovery(onRecovered))

    unmount()

    await act(async () => {
      vi.advanceTimersByTime(120_000)
    })

    expect(mockCheckHealth).not.toHaveBeenCalled()
  })

  it('resets backoff delay when errors are cleared and reappear', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    const { rerender } = renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(2)

    storeMock.__setHasError(false)
    rerender()

    storeMock.__setHasError(true)
    rerender()

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(mockCheckHealth).toHaveBeenCalledTimes(3)
  })

  it('invalidates health cache before each poll', async () => {
    storeMock.__setHasError(true)
    mockCheckHealth.mockResolvedValue(false)

    renderHook(() => useConnectionRecovery(onRecovered))

    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })

    expect(mockInvalidateCache).toHaveBeenCalledTimes(1)
    expect(mockInvalidateCache).toHaveBeenCalledBefore(mockCheckHealth)
  })
})
