/**
 * A shelf's filing suggestions while an upload is on screen: read again on the
 * shelf's live hint, on a slow clock when no hint comes, and never on another
 * shelf's hint.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scriptedChannels, type ScriptedChannels } from '@/test-utils/live-channels'
import { listOpenProposals } from '@/lib/proposals/client'
import { FILING_FALLBACK_POLL_MS, useFilingSuggestions } from './use-filing-suggestions'

const live = vi.hoisted(() => ({ current: null as ScriptedChannels | null }))
vi.mock('@/features/realtime/connection', async (original) => ({
  ...(await original<typeof import('@/features/realtime/connection')>()),
  getRealtimeConnection: () => live.current!.connection,
}))
vi.mock('@/lib/proposals/client', () => ({ listOpenProposals: vi.fn() }))

const CHANGED = { kind: 'shelf.changed', folders: false }
const PROJECT = { projectId: 'proj-1' } as const
const reads = () => vi.mocked(listOpenProposals).mock.calls.length

beforeEach(() => {
  vi.useFakeTimers()
  live.current = scriptedChannels((ms) => vi.advanceTimersByTime(ms))
  vi.mocked(listOpenProposals).mockResolvedValue({ proposals: [], nextCursor: null })
})
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useFilingSuggestions', () => {
  it('reads once when shown, and once more per hint on its shelf while an upload is on screen', () => {
    renderHook(() => useFilingSuggestions({ query: PROJECT, watching: true }))
    expect(live.current!.open()).toEqual(['shelf:project-proj-1'])
    expect(reads()).toBe(1)

    live.current!.hint('shelf:project-proj-1', CHANGED)
    expect(reads()).toBe(2)
    expect(listOpenProposals).toHaveBeenLastCalledWith({ projectId: 'proj-1', kind: 'file_operation' })
  })

  it('reads nothing on another project’s hint or the office shelf’s', () => {
    renderHook(() => useFilingSuggestions({ query: PROJECT, watching: true }))
    live.current!.hint('shelf:project-proj-2', CHANGED)
    live.current!.hint('shelf:office_shelf', CHANGED)
    expect(reads()).toBe(1)
  })

  it('still reads on a slow clock when no hint comes', () => {
    renderHook(() => useFilingSuggestions({ query: PROJECT, watching: true }))
    act(() => vi.advanceTimersByTime(FILING_FALLBACK_POLL_MS - 1))
    expect(reads()).toBe(1)
    act(() => vi.advanceTimersByTime(1))
    expect(reads()).toBe(2)
  })

  it('opens no channel and keeps no clock with no upload on screen', () => {
    renderHook(() => useFilingSuggestions({ query: PROJECT, watching: false }))
    expect(live.current!.open()).toEqual([])
    act(() => vi.advanceTimersByTime(3 * FILING_FALLBACK_POLL_MS))
    expect(reads()).toBe(1)
  })

  it('listens on the office shelf for the office shelf', () => {
    renderHook(() => useFilingSuggestions({ query: { shelf: 'office_shelf' }, watching: true }))
    expect(live.current!.open()).toEqual(['shelf:office_shelf'])
  })
})
