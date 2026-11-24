import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import { JobApiError, type JobRun } from '@/adapters/api/jobs-client'
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

describe('SessionsPanel - Deep Research section', () => {
  const today = new Date()
  const sessions = [{ id: 'conv-1', title: 'Fire safety review', date: today }]

  const renderPanel = (extra: Partial<Parameters<typeof SessionsPanel>[0]> = {}) =>
    render(<SessionsPanel sessions={sessions} projectId="p1" {...extra} />)

  beforeEach(() => {
    vi.clearAllMocks()
    setupChatStoreMock()
    mockListProjectRuns.mockResolvedValue([])
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
    expect(mockListProjectRuns).not.toHaveBeenCalled()
  })

  test('reads the deep-research runs of the project from the run ledger, with a count', async () => {
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ id: 'run-1' }), makeLedgerRun({ id: 'run-2' })])

    renderPanel()

    const section = await screen.findByTestId('deep-research-section')
    await waitFor(() => {
      expect(within(section).getByText('2')).toBeInTheDocument()
    })
    const researchFilter = screen.getByRole('radio', { name: /deep research/i })
    expect(within(researchFilter).getByText('2')).toBeInTheDocument()
    expect(mockListProjectRuns).toHaveBeenCalledWith('p1', { limit: 50, kind: 'deep-research' })
  })

  test('hides the section and the filter where the organization has no deep research', async () => {
    mockListProjectRuns.mockRejectedValue(new JobApiError('forbidden', 403, 'feature_disabled', null))

    renderPanel()

    await waitFor(() => {
      expect(screen.queryByRole('radiogroup', { name: /filter history/i })).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('deep-research-section')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: fire safety review/i })).toBeInTheDocument()
  })

  test('names a run by its own title and links to its message in the thread', async () => {
    mockListProjectRuns.mockResolvedValue([
      makeLedgerRun({ id: 'run-1', title: 'OIB 2 Prüfung', conversationId: 'conv-9', runMessageId: 'msg-9' }),
      makeLedgerRun({ id: 'run-2', title: '  ', conversationId: null, runMessageId: null }),
    ])

    renderPanel()

    const linked = await screen.findByRole('link', { name: /Open deep research run: OIB 2 Prüfung/i })
    expect(linked.getAttribute('href')).toBe('/app/projects/p1/chat?session=conv-9&run=run-1#message-msg-9')
    expect(screen.getByText('Deep research run')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open deep research run: Deep research run/i })).not.toBeInTheDocument()
  })

  test.each([
    ['succeeded', 'Done'],
    ['failed', 'Failed'],
    ['error', 'Submission failed'],
    ['interrupted', 'Stopped'],
    ['skipped', 'Skipped'],
    ['queued', 'Queued'],
    ['running', 'Running'],
  ] as const)('a %s run reads "%s"', async (status, label) => {
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ status })])

    renderPanel()

    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.getAllByText(/^(Done|Failed|Submission failed|Stopped|Skipped|Queued|Running)$/)).toHaveLength(1)
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
    mockListProjectRuns.mockReturnValue(new Promise(() => {}))

    renderPanel()

    expect(screen.getByTestId('deep-research-skeleton')).toHaveAttribute('aria-busy', 'true')
  })

  test('a failed runs fetch shows a retry line instead of a silently empty section', async () => {
    mockListProjectRuns
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([makeLedgerRun({ title: 'Fire safety review' })])

    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByText('Deep-research runs could not be loaded.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: /Open deep research run: Fire safety review/i })).toBeInTheDocument()
    expect(mockListProjectRuns).toHaveBeenCalledTimes(2)
  })

  test('the scope filter shows chats, runs, or both', async () => {
    mockListProjectRuns.mockResolvedValue([makeLedgerRun()])

    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByRole('link', { name: /open deep research run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: fire safety review/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Chats' }))
    expect(screen.queryByRole('link', { name: /open deep research run/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: fire safety review/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /deep research/i }))
    expect(await screen.findByRole('link', { name: /open deep research run/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /chat: fire safety review/i })).not.toBeInTheDocument()
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
    let resolveRuns: (value: JobRun[]) => void = () => {}
    mockListProjectRuns.mockReturnValue(
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

    const { rerender } = render(<SessionsPanel sessions={sessions} projectId="p1" />)

    expect(mockListProjectRuns).toHaveBeenCalledTimes(1)

    isPanelOpen = false
    rerender(<SessionsPanel sessions={sessions} projectId="p1" />)
    isPanelOpen = true
    rerender(<SessionsPanel sessions={sessions} projectId="p1" />)

    resolveRuns([makeLedgerRun({ id: 'run-1' }), makeLedgerRun({ id: 'run-2' })])

    expect(await screen.findAllByRole('link', { name: /open deep research run/i })).toHaveLength(2)
  })
})
