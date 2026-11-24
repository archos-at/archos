import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SessionsPanel } from './SessionsPanel'
import { JobApiError } from '@/adapters/api/jobs-client'
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

vi.mock('../store', () => ({
  useLayoutStore: vi.fn(),
}))

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn(),
}))

describe('SessionsPanel - deep research marks the chat that holds it', () => {
  const today = new Date()
  const sessions = [
    { id: 'conv-research', title: 'OIB 2 Prüfung', date: today },
    { id: 'conv-plain', title: 'Stellplatznachweis', date: today },
  ]

  const renderPanel = (projectId: string | undefined = 'p1') =>
    render(<SessionsPanel sessions={sessions} projectId={projectId} />)

  const rowOf = (title: RegExp) => screen.getByRole('button', { name: title })

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

  test('keeps runs out of a list of their own: the history is the chats, newest first', async () => {
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ conversationId: 'conv-research' })])

    renderPanel()

    await waitFor(() => {
      expect(within(rowOf(/chat: oib 2 prüfung/i)).getByText('Deep Research')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('deep-research-section')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /deep research run/i })).not.toBeInTheDocument()
    expect(within(rowOf(/chat: stellplatznachweis/i)).queryByText('Deep Research')).not.toBeInTheDocument()
    expect(mockListProjectRuns).toHaveBeenCalledWith('p1', { limit: 50, kind: 'deep-research' })
  })

  test.each([
    ['running', 'Working on this chat'],
    ['queued', 'Working on this chat'],
    ['succeeded', 'Report ready'],
    ['failed', 'Research failed'],
    ['error', 'Research failed'],
  ] as const)('a chat whose newest run is %s reads "%s"', async (status, label) => {
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ conversationId: 'conv-research', status })])

    renderPanel()

    expect(await screen.findByRole('button', { name: `Chat: OIB 2 Prüfung — ${label}` })).toBeInTheDocument()
  })

  test('the newest run of a chat decides its mark', async () => {
    mockListProjectRuns.mockResolvedValue([
      makeLedgerRun({ id: 'old', conversationId: 'conv-research', status: 'failed', createdAt: '2026-09-01T00:00:00.000Z' }),
      makeLedgerRun({ id: 'new', conversationId: 'conv-research', status: 'succeeded', createdAt: '2026-09-28T00:00:00.000Z' }),
    ])

    renderPanel()

    expect(await screen.findByRole('button', { name: 'Chat: OIB 2 Prüfung — Report ready' })).toBeInTheDocument()
  })

  test('the filter narrows the one list to research chats, or to the others, with a count', async () => {
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ conversationId: 'conv-research' })])
    const user = userEvent.setup()

    renderPanel()

    const researchFilter = await screen.findByRole('radio', { name: /deep research/i })
    await waitFor(() => expect(within(researchFilter).getByText('1')).toBeInTheDocument())

    await user.click(researchFilter)
    expect(rowOf(/chat: oib 2 prüfung/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /chat: stellplatznachweis/i })).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('radio', { name: 'Chats' }))
    expect(await screen.findByRole('button', { name: /chat: stellplatznachweis/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /chat: oib 2 prüfung/i })).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('radio', { name: 'All' }))
    expect(await screen.findByRole('button', { name: /chat: oib 2 prüfung/i })).toBeInTheDocument()
    expect(rowOf(/chat: stellplatznachweis/i)).toBeInTheDocument()
  })

  test('the Deep Research filter says so when no chat holds a run', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('radio', { name: /deep research/i }))
    expect(await screen.findByText('No deep research runs yet')).toBeInTheDocument()
  })

  test('an office without deep research gets no filter, and its chats stay unmarked', async () => {
    mockListProjectRuns.mockRejectedValue(new JobApiError('forbidden', 403, 'feature_disabled', null))

    renderPanel()

    await waitFor(() => {
      expect(screen.queryByRole('radiogroup', { name: /filter history/i })).not.toBeInTheDocument()
    })
    expect(within(rowOf(/chat: oib 2 prüfung/i)).queryByText('Deep Research')).not.toBeInTheDocument()
  })

  test('outside a project nothing is fetched and no filter shows', () => {
    render(<SessionsPanel sessions={sessions} />)

    expect(screen.queryByRole('radiogroup', { name: /filter history/i })).not.toBeInTheDocument()
    expect(mockListProjectRuns).not.toHaveBeenCalled()
  })

  test('a failed ledger read keeps the chats and their own marks', async () => {
    mockListProjectRuns.mockRejectedValue(new Error('network down'))

    render(
      <SessionsPanel
        sessions={[{ id: 'conv-live', title: 'Live chat', date: today, hasActiveDeepResearch: true }]}
        projectId="p1"
      />
    )

    await waitFor(() => expect(mockListProjectRuns).toHaveBeenCalled())
    expect(within(rowOf(/chat: live chat/i)).getByText('Deep Research')).toBeInTheDocument()
  })

  test('a chat row offers no stop action: a run is stopped from its block in the thread', async () => {
    mockListProjectRuns.mockResolvedValue([makeLedgerRun({ conversationId: 'conv-research', status: 'running' })])

    renderPanel()

    await waitFor(() => {
      expect(within(rowOf(/chat: oib 2 prüfung/i)).getByText('Deep Research')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /stop research/i })).not.toBeInTheDocument()
  })
})
