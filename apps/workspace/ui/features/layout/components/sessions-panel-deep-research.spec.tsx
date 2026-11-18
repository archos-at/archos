import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import type { ResearchRun } from '@/adapters/api/research-runs-client'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore } from '../types'
import { useLayoutStore } from '../store'
import { setupChatStoreMock } from './sessions-panel.fixtures'

const mockSetSessionsPanelOpen = vi.fn()

const mockListResearchRuns = vi.fn()
vi.mock('@/adapters/api/research-runs-client', () => ({
  listResearchRuns: (...args: unknown[]) => mockListResearchRuns(...args),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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

describe('SessionsPanel - Deep Research section (FB-10)', () => {
  const today = new Date()

  const makeRun = (overrides: Partial<ResearchRun>): ResearchRun => ({
    job_id: 'job-aaaaaaaa1111',
    status: 'completed',
    created_at: today.toISOString(),
    conversation_id: null,
    project_collection: 'proj_1',
    ...overrides,
  })

  const sessions = [{ id: 'conv-1', title: 'Fire safety review', date: today }]

  const renderPanel = (extra: Partial<Parameters<typeof SessionsPanel>[0]> = {}) =>
    render(
      <SessionsPanel
        sessions={sessions}
        projectId="p1"
        {...extra}
      />
    )

  beforeEach(() => {
    vi.clearAllMocks()
    setupChatStoreMock()
    mockListResearchRuns.mockResolvedValue({ jobs: [], total: 0 })
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: true,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })
  })

  test('does not render the section, the filter, or fetch runs outside a project', () => {
    render(<SessionsPanel sessions={sessions} />)

    expect(screen.queryByTestId('deep-research-section')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: /filter history/i })).not.toBeInTheDocument()
    expect(mockListResearchRuns).not.toHaveBeenCalled()
  })

  test('renders a run count and fetches runs scoped to the project collection', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [makeRun({ job_id: 'job-1' }), makeRun({ job_id: 'job-2' })],
      total: 2,
    })

    renderPanel()

    const section = await screen.findByTestId('deep-research-section')
    await waitFor(() => {
      expect(within(section).getByText('2')).toBeInTheDocument()
    })
    const researchFilter = screen.getByRole('radio', { name: /deep research/i })
    expect(within(researchFilter).getByText('2')).toBeInTheDocument()

    expect(mockListResearchRuns).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' })
    )
  })

  test('shows runs by default: session-title label, untitled fallback, and thread hrefs', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        makeRun({ job_id: 'job-completed', status: 'completed', conversation_id: 'conv-1' }),
        makeRun({ job_id: 'job-failed', status: 'failed', conversation_id: null }),
      ],
      total: 2,
    })

    renderPanel()

    const completed = await screen.findByRole('link', {
      name: /Open deep research run: Fire safety review/i,
    })
    expect(completed.getAttribute('href')).toBe('/app/projects/p1/chat?session=conv-1')

    expect(screen.getByText('Deep research run')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Open deep research run: Deep research run/i })
    ).not.toBeInTheDocument()
  })

  test('a run states its status in words, not only in its icon', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [
        makeRun({ job_id: 'job-ok', status: 'completed', conversation_id: 'conv-1' }),
        makeRun({ job_id: 'job-bad', status: 'failed', conversation_id: 'conv-2' }),
        makeRun({ job_id: 'job-live', status: 'running', conversation_id: 'conv-3' }),
      ],
      total: 3,
    })

    renderPanel()

    expect(await screen.findByText('Report ready')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Open deep research run: .* — Failed/i })
    ).toBeInTheDocument()
  })

  test('marks research-carrying sessions with a Deep Research chip', async () => {
    render(
      <SessionsPanel
        sessions={[{ id: 'conv-1', title: 'Research chat', date: today, hasCompletedReport: true }]}
        projectId="p1"
      />
    )

    const row = screen.getByRole('button', { name: /chat: research chat/i })
    await waitFor(() => {
      expect(within(row).getByText('Deep Research')).toBeInTheDocument()
    })
  })

  test('shows skeleton rows while the first runs fetch is pending', () => {
    mockListResearchRuns.mockReturnValue(new Promise(() => {}))

    renderPanel()

    const skeleton = screen.getByTestId('deep-research-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
  })

  test('a failed runs fetch shows a retry line instead of a silently empty section', async () => {
    mockListResearchRuns
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        jobs: [makeRun({ job_id: 'job-1', conversation_id: 'conv-1' })],
        total: 1,
      })

    const user = userEvent.setup()
    renderPanel()

    expect(
      await screen.findByText('Deep-research runs could not be loaded.')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('link', { name: /Open deep research run: Fire safety review/i })
    ).toBeInTheDocument()
    expect(mockListResearchRuns).toHaveBeenCalledTimes(2)
  })

  test('the scope filter shows chats, runs, or both', async () => {
    mockListResearchRuns.mockResolvedValue({
      jobs: [makeRun({ job_id: 'job-1', conversation_id: 'conv-1' })],
      total: 1,
    })

    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByRole('link', { name: /open deep research run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: fire safety review/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Chats' }))
    expect(screen.queryByRole('link', { name: /open deep research run/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: fire safety review/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /deep research/i }))
    expect(await screen.findByRole('link', { name: /open deep research run/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /chat: fire safety review/i })
    ).not.toBeInTheDocument()
  })

  test('the Deep Research scope shows a proper empty state when there are no runs', async () => {
    const user = userEvent.setup()
    renderPanel()

    await waitFor(() => {
      expect(screen.queryByTestId('deep-research-skeleton')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('deep-research-section')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /deep research/i }))
    expect(await screen.findByText('No deep research runs yet')).toBeInTheDocument()
  })

  test('populates the section after a quick close→reopen while the fetch is pending', async () => {
    let isPanelOpen = true
    let resolveRuns: (value: { jobs: ResearchRun[]; total: number }) => void = () => {}
    mockListResearchRuns.mockReturnValue(
      new Promise((resolve) => {
        resolveRuns = resolve
      })
    )
    vi.mocked(useLayoutStore).mockImplementation((selector?: StoreSelector<LayoutStore>) => {
      const state: DeepPartial<LayoutStore> = {
        isSessionsPanelOpen: isPanelOpen,
        setSessionsPanelOpen: mockSetSessionsPanelOpen,
      }
      return selector ? selector(asStoreState<LayoutStore>(state)) : state
    })

    const { rerender } = render(
      <SessionsPanel sessions={sessions} projectId="p1" />
    )

    expect(mockListResearchRuns).toHaveBeenCalledTimes(1)

    isPanelOpen = false
    rerender(
      <SessionsPanel sessions={sessions} projectId="p1" />
    )
    isPanelOpen = true
    rerender(
      <SessionsPanel sessions={sessions} projectId="p1" />
    )

    resolveRuns({
      jobs: [
        makeRun({ job_id: 'job-1', conversation_id: 'conv-1' }),
        makeRun({ job_id: 'job-2', conversation_id: 'conv-2' }),
      ],
      total: 2,
    })

    expect(
      await screen.findAllByRole('link', { name: /open deep research run/i })
    ).toHaveLength(2)
  })
})
