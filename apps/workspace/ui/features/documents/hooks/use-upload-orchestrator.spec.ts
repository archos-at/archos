/**
 * An upload surface's tie to the orchestrator: the shelf's live hint is passed
 * on as `askNow` while a read is in flight, on this shelf's channel only, and
 * a chat's attachments open no channel.
 */

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { scriptedChannels, type ScriptedChannels } from '@/test-utils/live-channels'
import { UploadOrchestrator } from '../orchestrator'
import { useDocumentsStore } from '../store'
import { useUploadOrchestrator } from './use-upload-orchestrator'

const live = vi.hoisted(() => ({ current: null as ScriptedChannels | null }))
vi.mock('@/features/realtime/connection', async (original) => ({
  ...(await original<typeof import('@/features/realtime/connection')>()),
  getRealtimeConnection: () => live.current!.connection,
}))

const CHANGED = { kind: 'shelf.changed', folders: false }
let askNow: MockInstance<() => void>

beforeEach(() => {
  vi.useFakeTimers()
  live.current = scriptedChannels((ms) => vi.advanceTimersByTime(ms))
  askNow = vi.spyOn(UploadOrchestrator, 'askNow').mockImplementation(() => undefined)
  vi.spyOn(UploadOrchestrator, 'handleSessionChange').mockResolvedValue(undefined)
  vi.spyOn(UploadOrchestrator, 'loadFilesForSession').mockResolvedValue(undefined)
  useDocumentsStore.setState({ isPolling: true, trackedFiles: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  useDocumentsStore.setState({ isPolling: false, trackedFiles: [] })
})

describe('useUploadOrchestrator', () => {
  it('asks the orchestrator once per hint on its shelf, and once when the channel comes up', () => {
    renderHook(() => useUploadOrchestrator({ collectionName: 'col-1', projectId: 'proj-1' }))
    expect(live.current!.open()).toEqual(['shelf:project-proj-1'])

    live.current!.up('shelf:project-proj-1')
    expect(askNow).toHaveBeenCalledTimes(1)

    live.current!.hint('shelf:project-proj-1', CHANGED)
    expect(askNow).toHaveBeenCalledTimes(2)
  })

  it('hears nothing from another project’s shelf or the office shelf', () => {
    renderHook(() => useUploadOrchestrator({ collectionName: 'col-1', projectId: 'proj-1' }))
    live.current!.hint('shelf:project-proj-2', CHANGED)
    live.current!.hint('shelf:office_shelf', CHANGED)
    expect(askNow).not.toHaveBeenCalled()
  })

  it('opens the office shelf’s channel for an office-shelf surface', () => {
    renderHook(() => useUploadOrchestrator({ collectionName: 'col-1', officeShelf: true }))
    expect(live.current!.open()).toEqual(['shelf:office_shelf'])
  })

  it('opens no channel while nothing is being read', () => {
    useDocumentsStore.setState({ isPolling: false })
    renderHook(() => useUploadOrchestrator({ collectionName: 'col-1', projectId: 'proj-1' }))
    expect(live.current!.open()).toEqual([])
  })

  it('opens no channel for a chat’s attachments, which are on no shelf', () => {
    renderHook(() => useUploadOrchestrator({ collectionName: 'conversation-1' }))
    expect(live.current!.open()).toEqual([])
    expect(UploadOrchestrator.handleSessionChange).toHaveBeenCalledWith('conversation-1', 'session')
  })
})
