import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { frameOf } from '@/test-utils/wire-v2-fixtures'
import { useSpectatedTurn } from './use-spectated-turn'
import { CARD_PREVIEW_FIXTURES } from '@/features/cards/preview-fixtures'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

function frame(seq: number, body: Record<string, unknown>, turnId = 'turn-1') {
  return { kind: 'frame', payload: frameOf(seq, body, turnId) }
}

function toolStep(id: string, status: 'running' | 'ok' = 'running') {
  return { type: 'STEP_STARTED', step: { id, kind: 'tool', tool: 'ris_search', status } }
}

function delta(text: string) {
  return { type: 'TEXT_MESSAGE_CONTENT', message_id: 'answer-1', delta: text }
}

describe('useSpectatedTurn', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens nothing when disabled', () => {
    renderHook(() => useSpectatedTurn({ conversationId: 'conv_1', enabled: false }))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('opens nothing without a conversation', () => {
    renderHook(() => useSpectatedTurn({ conversationId: null, enabled: true }))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('opens the conversation stream when a colleague is being answered', () => {
    renderHook(() => useSpectatedTurn({ conversationId: 'conv_1', enabled: true }))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/conversations/conv_1/live')
  })

  it('goes live only once there is something to show', async () => {
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
    )
    expect(result.current.live).toBe(false)

    act(() => FakeEventSource.instances[0].emit(frame(1, delta('Ja, '))))
    await waitFor(() => expect(result.current.live).toBe(true))
    expect(result.current.turn?.text).toBe('Ja, ')
  })

  it('goes live on a masthead alone, before the first word', async () => {
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
    )
    const masthead = { type: 'CUSTOM', name: 'masthead', value: { answer_meta: { v: 1, kind: 'direct', topic: 'Kurz' } } }
    act(() => FakeEventSource.instances[0].emit(frame(1, masthead)))
    await waitFor(() => expect(result.current.live).toBe(true))
    expect(result.current.turn?.text).toBe('')
  })

  it('goes live on cards alone, before the first word', async () => {
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
    )
    const cards = {
      type: 'CUSTOM',
      name: 'card',
      value: { index: 0, key: 'k1', card: CARD_PREVIEW_FIXTURES.calculation },
    }
    act(() => FakeEventSource.instances[0].emit(frame(1, cards)))
    await waitFor(() => expect(result.current.live).toBe(true))
  })

  it('ignores a frame it has already applied', async () => {
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
    )
    const source = FakeEventSource.instances[0]

    act(() => source.emit(frame(1, delta('Ja, '))))
    act(() => source.emit(frame(2, delta('ab drei Geschossen.'))))
    act(() => source.emit(frame(2, delta('ab drei Geschossen.'))))

    await waitFor(() => expect(result.current.turn?.text).toBe('Ja, ab drei Geschossen.'))
  })

  it('reports every frame as activity, including ones that change nothing on screen', () => {
    const onFrame = vi.fn()
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true, onFrame })
    )
    const source = FakeEventSource.instances[0]

    act(() => source.emit(frame(1, toolStep('tool:1'))))
    act(() => source.emit(frame(2, toolStep('tool:1'))))
    act(() => source.emit(frame(3, toolStep('tool:1'))))
    act(() => source.emit(frame(3, toolStep('tool:1'))))

    expect(result.current.turn?.stepOrder).toHaveLength(1)
    expect(result.current.turn?.text).toBe('')
    expect(onFrame).toHaveBeenCalledTimes(4)
  })

  it('closes and reports nothing when the server has no live channel', async () => {
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
    )
    const source = FakeEventSource.instances[0]

    act(() => source.emit({ kind: 'unsupported' }))

    await waitFor(() => expect(source.closed).toBe(true))
    expect(result.current.live).toBe(false)
    expect(result.current.turn).toBeNull()
  })

  it('stops when access is revoked mid-stream', async () => {
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
    )
    const source = FakeEventSource.instances[0]

    act(() => source.emit(frame(1, delta('Teilantwort'))))
    act(() => source.emit({ kind: 'revoked' }))

    await waitFor(() => expect(result.current.turn).toBeNull())
    expect(source.closed).toBe(true)
  })

  it('closes the stream when the turn ends', async () => {
    const { rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useSpectatedTurn({ conversationId: 'conv_1', enabled: props.enabled }),
      { initialProps: { enabled: true } }
    )
    const source = FakeEventSource.instances[0]
    rerender({ enabled: false })
    await waitFor(() => expect(source.closed).toBe(true))
  })

  it('clears the half-written answer when the turn ends', async () => {
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useSpectatedTurn({ conversationId: 'conv_1', enabled: props.enabled }),
      { initialProps: { enabled: true } }
    )
    act(() => FakeEventSource.instances[0].emit(frame(1, delta('Halb geschriebene '))))
    await waitFor(() => expect(result.current.turn?.text).toBe('Halb geschriebene '))

    rerender({ enabled: false })
    await waitFor(() => expect(result.current.turn).toBeNull())
  })

  it('degrades quietly in a runtime with no EventSource', () => {
    vi.stubGlobal('EventSource', undefined)
    const { result } = renderHook(() =>
      useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
    )
    expect(result.current.turn).toBeNull()
    expect(result.current.live).toBe(false)
  })
})

describe('reconnect policy', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('backs off, and gives up rather than hammering the route', () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useSpectatedTurn({ conversationId: 'conv_1', enabled: true }))
      expect(FakeEventSource.instances).toHaveLength(1)

      for (let round = 0; round < 6; round += 1) {
        const live = FakeEventSource.instances.at(-1)!
        act(() => live.onerror?.())
        expect(live.closed).toBe(true)
        act(() => {
          vi.advanceTimersByTime(60_000)
        })
      }

      expect(FakeEventSource.instances.length).toBeGreaterThan(1)
      expect(FakeEventSource.instances.length).toBeLessThanOrEqual(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not spend the budget on failures separated by working stretches', () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useSpectatedTurn({ conversationId: 'conv_1', enabled: true }))

      for (let round = 0; round < 8; round += 1) {
        const live = FakeEventSource.instances.at(-1)!
        act(() => live.emit(frame(round + 1, delta('x'))))
        act(() => live.onerror?.())
        act(() => {
          vi.advanceTimersByTime(60_000)
        })
      }

      expect(FakeEventSource.instances).toHaveLength(9)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reconnect after the effect is torn down', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = renderHook(() =>
        useSpectatedTurn({ conversationId: 'conv_1', enabled: true })
      )
      const live = FakeEventSource.instances.at(-1)!
      act(() => live.onerror?.())
      unmount()
      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(FakeEventSource.instances).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
