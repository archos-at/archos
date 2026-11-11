/**
 * The import dialog's list while an import runs: read again on the project's
 * shelf hint, on a slow clock when no hint comes, never on another shelf's
 * hint, and not at all once nothing is running.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scriptedChannels, type ScriptedChannels } from '@/test-utils/live-channels'
import { fetchMailImports } from '@/lib/mail-import/client'
import type { MailImportList, MailImportView } from '@/lib/mail-import/types'
import { MAIL_IMPORT_FALLBACK_POLL_MS, useMailImports } from './use-mail-imports'

const live = vi.hoisted(() => ({ current: null as ScriptedChannels | null }))
vi.mock('@/features/realtime/connection', async (original) => ({
  ...(await original<typeof import('@/features/realtime/connection')>()),
  getRealtimeConnection: () => live.current!.connection,
}))
vi.mock('@/lib/mail-import/client', async (original) => ({
  ...(await original<typeof import('@/lib/mail-import/client')>()),
  fetchMailImports: vi.fn(),
}))

const CHANGED = { kind: 'shelf.changed', folders: true }
const listOf = (status: MailImportView['status']): MailImportList => ({
  imports: [{ id: 'imp-1', status } as MailImportView],
  nextCursor: null,
  maxSizeBytes: 1,
  partSize: 1,
})
const reads = () => vi.mocked(fetchMailImports).mock.calls.length
/** Let the first read land, so the hook knows an import is running. */
const landed = () => act(() => vi.advanceTimersByTimeAsync(0))

beforeEach(() => {
  vi.useFakeTimers()
  live.current = scriptedChannels((ms) => vi.advanceTimersByTime(ms))
  vi.mocked(fetchMailImports).mockResolvedValue(listOf('importing'))
})
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useMailImports, while an import runs', () => {
  it('reads the list once more per hint on the project’s shelf', async () => {
    renderHook(() => useMailImports('proj-1', true))
    await landed()
    expect(live.current!.open()).toEqual(['shelf:project-proj-1'])
    const before = reads()

    live.current!.hint('shelf:project-proj-1', CHANGED)
    expect(reads()).toBe(before + 1)
    expect(fetchMailImports).toHaveBeenLastCalledWith('proj-1')
  })

  it('reads nothing on another project’s hint', async () => {
    renderHook(() => useMailImports('proj-1', true))
    await landed()
    const before = reads()
    live.current!.hint('shelf:project-proj-2', CHANGED)
    live.current!.hint('shelf:office_shelf', CHANGED)
    expect(reads()).toBe(before)
  })

  it('still reads on a slow clock when no hint comes', async () => {
    renderHook(() => useMailImports('proj-1', true))
    await landed()
    const before = reads()
    await act(() => vi.advanceTimersByTimeAsync(MAIL_IMPORT_FALLBACK_POLL_MS - 1))
    expect(reads()).toBe(before)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(reads()).toBe(before + 1)
  })

  it('closes the channel and stops the clock once the import ended', async () => {
    renderHook(() => useMailImports('proj-1', true))
    await landed()
    vi.mocked(fetchMailImports).mockResolvedValue(listOf('completed'))
    live.current!.hint('shelf:project-proj-1', CHANGED)
    await landed()
    expect(live.current!.open()).toEqual([])
    const after = reads()
    await act(() => vi.advanceTimersByTimeAsync(3 * MAIL_IMPORT_FALLBACK_POLL_MS))
    expect(reads()).toBe(after)
  })

  it('opens no channel while the dialog is closed', async () => {
    renderHook(() => useMailImports('proj-1', false))
    await landed()
    expect(live.current!.open()).toEqual([])
    expect(reads()).toBe(0)
  })
})
