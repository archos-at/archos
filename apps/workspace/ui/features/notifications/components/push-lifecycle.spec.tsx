import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@/test-utils'
import { LEGACY_WORKER_MESSAGES } from '@/lib/push/legacy-worker-names'
import { PushLifecycle } from './push-lifecycle'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/lib/push/browser', () => ({ registerWorker: vi.fn(async () => null) }))
vi.mock('../hooks/use-push-notifications', () => ({ refreshRegisteredDevice: vi.fn(async () => undefined) }))

type WorkerMessage = { data: unknown }

describe('the page follows a tap the worker sends it', () => {
  let onMessage: ((event: WorkerMessage) => void) | undefined

  beforeEach(() => {
    onMessage = undefined
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: WorkerMessage) => void) => {
          onMessage = listener
        },
        removeEventListener: vi.fn(),
      },
    })
  })

  afterEach(() => {
    router.push.mockClear()
  })

  it.each([
    ['the new message', 'navigate'],
    ['the old message, from a worker one release old', LEGACY_WORKER_MESSAGES.navigate],
  ])('routes to the address it is sent, for %s', (_label, type) => {
    render(<PushLifecycle enabled />)
    act(() => onMessage?.({ data: { type, url: '/app/inbox?x=1' } }))
    expect(router.push).toHaveBeenCalledWith('/app/inbox?x=1')
  })

  it('routes once when a current worker sends the new message and its old copy', () => {
    render(<PushLifecycle enabled />)
    act(() => onMessage?.({ data: { type: 'navigate', url: '/app/inbox?x=1' } }))
    act(() => onMessage?.({ data: { type: LEGACY_WORKER_MESSAGES.navigate, url: '/app/inbox?x=1' } }))
    expect(router.push).toHaveBeenCalledTimes(1)
  })

  it('routes again for an old message that names another address', () => {
    render(<PushLifecycle enabled />)
    act(() => onMessage?.({ data: { type: 'navigate', url: '/app/inbox?x=1' } }))
    act(() => onMessage?.({ data: { type: LEGACY_WORKER_MESSAGES.navigate, url: '/app/inbox?x=2' } }))
    expect(router.push).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['an absolute address', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example/x'],
    ['no address', undefined],
  ])('does not follow %s', (_label, url) => {
    render(<PushLifecycle enabled />)
    act(() => onMessage?.({ data: { type: 'navigate', url } }))
    expect(router.push).not.toHaveBeenCalled()
  })
})
