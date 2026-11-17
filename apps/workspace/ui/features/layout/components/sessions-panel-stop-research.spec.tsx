import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore } from '../types'
import { useLayoutStore } from '../store'
import { setupChatStoreMock } from './sessions-panel.fixtures'

const mockSetSessionsPanelOpen = vi.fn()

const mockListResearchRuns = vi.fn()
vi.mock('@/adapters/api/research-runs-client', () => ({
  listResearchRuns: (...args: unknown[]) => mockListResearchRuns(...args),
}))

const mockCancelJob = vi.fn()
vi.mock('@/adapters/api/deep-research-client', () => ({
  cancelJob: (...args: unknown[]) => mockCancelJob(...args),
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
    mockCancelJob.mockResolvedValue({ cancelled: true })
    mockListResearchRuns.mockResolvedValue({ jobs: [], total: 0 })
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
    render(
      <SessionsPanel
        sessions={[{ ...idleSession, hasActiveDeepResearch: true }]}
      />
    )
    expect(screen.queryByRole('button', { name: /stop research/i })).not.toBeInTheDocument()
  })

  test('a running research run offers a stop action that cancels the job and refetches', async () => {
    const user = userEvent.setup()
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        {
          job_id: 'job-live',
          status: 'running',
          created_at: today.toISOString(),
          conversation_id: null,
          project_collection: 'proj_1',
        },
      ],
      total: 1,
    })
    render(
      <SessionsPanel
        sessions={[idleSession]}
        projectId="p1"
      />
    )

    expect(await screen.findByText('Running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop research' }))
    expect(await screen.findByText('Stop research?')).toBeInTheDocument()
    await user.click(screen.getByTestId('stop-research-confirm'))

    await waitFor(() => {
      expect(mockCancelJob).toHaveBeenCalledWith('job-live', undefined, { projectId: 'p1' })
    })
    await waitFor(() => {
      expect(mockListResearchRuns).toHaveBeenCalledTimes(2)
    })
  })

  test('cancelling the stop confirm cancels nothing', async () => {
    const user = userEvent.setup()
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        {
          job_id: 'job-live',
          status: 'running',
          created_at: today.toISOString(),
          conversation_id: null,
          project_collection: 'proj_1',
        },
      ],
      total: 1,
    })
    render(
      <SessionsPanel
        sessions={[idleSession]}
        projectId="p1"
      />
    )
    expect(await screen.findByText('Running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop research' }))
    expect(await screen.findByText('Stop research?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockCancelJob).not.toHaveBeenCalled()
  })

  test('a finished research run offers no stop action', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        {
          job_id: 'job-done',
          status: 'completed',
          created_at: today.toISOString(),
          conversation_id: null,
          project_collection: 'proj_1',
        },
      ],
      total: 1,
    })
    render(
      <SessionsPanel
        sessions={[idleSession]}
        projectId="p1"
      />
    )

    expect(await screen.findByText('Report ready')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stop research/i })).not.toBeInTheDocument()
  })
})
