import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore } from '../types'
import { useLayoutStore } from '../store'
import { makeLedgerRun, setupChatStoreMock } from './sessions-panel.fixtures'

const mockSetSessionsPanelOpen = vi.fn()

const mockListProjectRuns = vi.fn()
vi.mock('@/adapters/api/jobs-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/adapters/api/jobs-client')>()),
  listProjectRuns: (...args: unknown[]) => mockListProjectRuns(...args),
}))

const mockCancelRun = vi.fn()
vi.mock('@/lib/runs/run-view-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/runs/run-view-client')>()),
  cancelRun: (...args: unknown[]) => mockCancelRun(...args),
}))

vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector?: StoreSelector<LayoutStore>) => {
    const state: DeepPartial<LayoutStore> = {
      isSessionsPanelOpen: true,
      setSessionsPanelOpen: mockSetSessionsPanelOpen,
    }
    return selector ? selector(asStoreState<LayoutStore>(state)) : state
  }),
}))

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn(),
}))

describe('SessionsPanel - stopping a run from the history', () => {
  const today = new Date()
  const idleSession = { id: 'conv-idle', title: 'Idle chat', date: today }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCancelRun.mockResolvedValue({})
    mockListProjectRuns.mockResolvedValue([])
    setupChatStoreMock()
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('a chat row offers no stop action: the run is stopped from its block', () => {
    render(<SessionsPanel sessions={[{ ...idleSession, hasActiveDeepResearch: true }]} />)
    expect(screen.queryByRole('button', { name: /stop research/i })).not.toBeInTheDocument()
  })

  test('a running run offers a stop that cancels it through the ledger and refetches', async () => {
    const user = userEvent.setup()
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ id: 'run-live', status: 'running' })])
    render(<SessionsPanel sessions={[idleSession]} projectId="p1" />)

    expect(await screen.findByText('Running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop research' }))
    expect(await screen.findByText('Stop research?')).toBeInTheDocument()
    await user.click(screen.getByTestId('stop-research-confirm'))

    await waitFor(() => {
      expect(mockCancelRun).toHaveBeenCalledWith('p1', 'run-live')
    })
    await waitFor(() => {
      expect(mockListProjectRuns).toHaveBeenCalledTimes(2)
    })
  })

  test('cancelling the stop confirm cancels nothing', async () => {
    const user = userEvent.setup()
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ status: 'queued' })])
    render(<SessionsPanel sessions={[idleSession]} projectId="p1" />)

    expect(await screen.findByText('Queued')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop research' }))
    expect(await screen.findByText('Stop research?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockCancelRun).not.toHaveBeenCalled()
  })

  test.each(['succeeded', 'failed', 'interrupted', 'skipped', 'error'] as const)(
    'a %s run offers no stop action',
    async (status) => {
      mockListProjectRuns.mockResolvedValue([makeLedgerRun({ status })])
      render(<SessionsPanel sessions={[idleSession]} projectId="p1" />)

      expect(await screen.findByRole('link', { name: /open deep research run/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /stop research/i })).not.toBeInTheDocument()
    }
  )
})
