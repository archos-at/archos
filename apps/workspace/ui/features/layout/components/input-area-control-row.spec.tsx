import { act, fireEvent, render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { resetThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useFileUpload, useFileDragDrop } from '@/features/documents'
import { AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE } from './input-area.fixtures'

const mockSendMessage = vi.fn()
const mockRespondToInteraction = vi.fn()
const mockNoteSendIntent = vi.fn()

let mockConversationMessages: unknown[] | undefined = []
let mockCurrentSessionId: string | null = 'session-1'
let mockComposerPrefill: ComposerPrefill | null = null
let mockComposerSubject: ComposerSubject | null = null
const mockSetComposerSubject = vi.fn((next: ComposerSubject | null) => {
  mockComposerSubject = next
})
let mockDrafts: Record<string, string> = {}
let mockIsStreaming = false
const mockStopStreaming = vi.fn()
const mockStartNewSessionDraft = vi.fn()

const mockSaveDataSourcesToConversation = vi.fn()

const mockEnsureConversationExists = vi.fn(async () => {})

function mockChatState() {
  return {
    currentConversation: mockCurrentSessionId
      ? { id: mockCurrentSessionId, messages: mockConversationMessages }
      : null,
    conversations: mockCurrentSessionId
      ? [{ id: mockCurrentSessionId, messages: mockConversationMessages ?? [] }]
      : [],
    saveDataSourcesToConversation: mockSaveDataSourcesToConversation,
    isStreaming: mockIsStreaming,
    stopStreaming: mockStopStreaming,
    ensureSession: vi.fn(() => {
      if (!mockCurrentSessionId) mockCurrentSessionId = 'session-new'
      return mockCurrentSessionId
    }),
    _ensureConversationExists: mockEnsureConversationExists,
    startNewSessionDraft: mockStartNewSessionDraft,
    setRespondToInteractionFn: vi.fn(),
    setChatSendFn: vi.fn(),
    composerPrefill: mockComposerPrefill,
    consumeComposerPrefill: vi.fn(() => {
      const value = mockComposerPrefill
      mockComposerPrefill = null
      return value
    }),
    composerSubject: mockComposerSubject,
    setComposerSubject: mockSetComposerSubject,
    composerDrafts: mockDrafts,
    getComposerDraft: (id: string) => mockDrafts[id] ?? '',
    setComposerDraft: (id: string, text: string) => {
      if (text === '') {
        delete mockDrafts[id]
        return
      }
      mockDrafts[id] = text
    },
    clearComposerDraft: (id: string) => {
      delete mockDrafts[id]
    },
  }
}

vi.mock('@/features/chat', () => ({
  useWebSocketChat: vi.fn(() => ({
    sendMessage: mockSendMessage,
    isStreaming: false,
    isLoading: false,
    respondToInteraction: mockRespondToInteraction,
    noteSendIntent: mockNoteSendIntent,
    pendingInteraction: null,
  })),
  useIsCurrentSessionBusy: vi.fn(() => false),
}))
vi.mock('@/features/chat/store', () => ({
  useChatStore: Object.assign(
    vi.fn((selector: (s: ReturnType<typeof mockChatState>) => unknown) => selector(mockChatState())),
    { getState: () => mockChatState() },
  ),
}))

const mockSetDataSourcePanelTab = vi.fn()

const mockSetDataSourcesPanelTab = vi.fn()
const mockApplySourcePreset = vi.fn()
let mockActiveSourcePreset: string | null = null
let mockAvailableDataSources: Array<{ id: string; name?: string }> = [
  { id: 'source-1', name: 'Quelle eins' },
  { id: 'source-2', name: 'Quelle zwei' },
]
let mockEnabledDataSourceIds: string[] = ['source-1', 'source-2']

const mockToggleDataSource = vi.fn()
const mockSetEnabledDataSources = vi.fn()
const mockFetchDataSources = vi.fn()

const mockLayoutState = () => ({
  setDataSourcesPanelTab: mockSetDataSourcesPanelTab,
  setDataSourcePanelTab: mockSetDataSourcePanelTab,
  enabledDataSourceIds: mockEnabledDataSourceIds,
  knowledgeLayerAvailable: true,
  availableDataSources: mockAvailableDataSources,
  activeSourcePreset: mockActiveSourcePreset,
  applySourcePreset: mockApplySourcePreset,
  toggleDataSource: mockToggleDataSource,
  setEnabledDataSources: mockSetEnabledDataSources,
  fetchDataSources: mockFetchDataSources,
  dataSourcesLoading: false,
  dataSourcesError: null as string | null,
})

type MockLayoutState = ReturnType<typeof mockLayoutState>

vi.mock('../store', () => ({
  useLayoutStore: Object.assign(
    vi.fn((selector?: (s: MockLayoutState) => unknown) => {
      const state = mockLayoutState()
      return selector ? selector(state) : state
    }),
    { getState: () => mockLayoutState() }
  ),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({ idToken: 'test-token', authRequired: true }),
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

const mockUploadFiles = vi.fn()

const mockDeleteFile = vi.fn()
const mockRetryFile = vi.fn()

vi.mock('@/features/documents', () => ({
  UploadAnywayButton: () => null,
  useFileUpload: vi.fn(() => ({
    uploadFiles: mockUploadFiles,
    sessionFiles: [],
    deleteFile: mockDeleteFile,
    retryFile: mockRetryFile,
    isUploading: false,
    error: null,
    clearError: vi.fn(),
  })),
  useFileDragDrop: vi.fn(() => ({
    isDragging: false,
    isUnsupportedDrag: false,
    refusal: null,
    dragHandlers: {
      onDragEnter: vi.fn(),
      onDragLeave: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
    },
  })),
}))

let mockMentionData: unknown = {
  candidates: [AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE],
  canInvite: true,
}
let mockMentionsLoading = false
const mockRestartMentionCandidates = vi.fn()

let mockAwaitingPending: Array<{ id: string }> = []

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useMentionCandidates: vi.fn((conversationId: string | null, enabled: boolean) => {
    const answering = enabled && conversationId !== null
    return {
      data: answering ? mockMentionData : null,
      loading: answering ? mockMentionsLoading : false,
      restart: mockRestartMentionCandidates,
    }
  }),
  useAwaitingState: vi.fn((_conversationId: string | null, enabled: boolean) => ({
    awaiting: enabled ? { pending: mockAwaitingPending, awaitingMe: false } : null,
    refresh: vi.fn(),
    release: vi.fn(),
  })),
}))

describe('InputArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationMessages = []
    mockCurrentSessionId = 'session-1'
    mockComposerPrefill = null
    mockComposerSubject = null
    mockDrafts = {}
    mockActiveSourcePreset = null
    mockIsStreaming = false
    mockAvailableDataSources = [
      { id: 'source-1', name: 'Quelle eins' },
      { id: 'source-2', name: 'Quelle zwei' },
    ]
    mockEnabledDataSourceIds = ['source-1', 'source-2']
    mockMentionData = {
      candidates: [AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE],
      canInvite: true,
    }
    mockMentionsLoading = false
    mockRestartMentionCandidates.mockClear()
    mockAwaitingPending = []
    resetThreadSharing()
    vi.mocked(useFileDragDrop).mockReturnValue({
      isDragging: false,
      isUnsupportedDrag: false,
      refusal: null,
      dragHandlers: {
        onDragEnter: vi.fn(),
        onDragLeave: vi.fn(),
        onDragOver: vi.fn(),
        onDrop: vi.fn(),
      },
    })
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      retryFile: mockRetryFile,
      sessionFiles: [],
      isUploading: false,
      error: null,
      clearError: vi.fn(),
    } as unknown as ReturnType<typeof useFileUpload>)
    mockSendMessage.mockReset()
    vi.mocked(useIsCurrentSessionBusy).mockReturnValue(false)
    vi.mocked(useWebSocketChat).mockReturnValue({
      sendMessage: mockSendMessage,
      isStreaming: false,
      isLoading: false,
      respondToInteraction: mockRespondToInteraction,
      noteSendIntent: mockNoteSendIntent,
      pendingInteraction: null,
    } as unknown as ReturnType<typeof useWebSocketChat>)
  })

  describe('composer control row (WS-3)', () => {
    test.skip('the trigger names the mix rather than counting it, and opens the picker', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const trigger = screen.getByRole('button', { name: /data basis/i })
      expect(trigger).toHaveTextContent('All sources')
      expect(trigger).not.toHaveTextContent('2')

      await user.click(trigger)

      expect(
        screen.getByText(/what it actually used is in the derivation/i)
      ).toBeInTheDocument()
    })

    test.skip('the office preset reads "Büroablage" on the trigger, never "0"', () => {
      mockActiveSourcePreset = 'office'
      mockEnabledDataSourceIds = []

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const trigger = screen.getByRole('button', { name: /data basis/i })
      expect(trigger).toHaveTextContent('Office filing')
      expect(trigger).not.toHaveTextContent('0')
    })

    test.skip('with every external source off the trigger says project knowledge only', () => {
      mockEnabledDataSourceIds = []

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.getByRole('button', { name: /data basis/i })).toHaveTextContent(
        'Project knowledge only'
      )
    })

    test.skip('the always-on knowledge layer is listed in the picker instead of hidden', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.click(screen.getByRole('button', { name: /data basis/i }))

      const alwaysOn = screen.getByRole('list', { name: /always included/i })
      expect(within(alwaysOn).getByText('Project knowledge')).toBeInTheDocument()
      expect(within(alwaysOn).getByText('Office filing')).toBeInTheDocument()
      expect(within(alwaysOn).getAllByText('Always on')).toHaveLength(2)
      expect(within(alwaysOn).queryAllByRole('switch')).toHaveLength(0)
    })

    test.skip('switching a source off in the picker persists the new basis', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.click(screen.getByRole('button', { name: /data basis/i }))
      await user.click(screen.getByRole('switch', { name: /allow quelle eins/i }))

      expect(mockToggleDataSource).toHaveBeenCalledWith('source-1')
      expect(mockSaveDataSourcesToConversation).toHaveBeenCalledWith(['source-2'])
    })

    test.skip('turning the last external source off warns, where the banner stays silent', async () => {
      const user = userEvent.setup()
      mockEnabledDataSourceIds = []

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      await user.click(screen.getByRole('button', { name: /data basis/i }))

      expect(
        screen.getByText(/search only your project documents/i)
      ).toBeInTheDocument()
    })

    test.skip('the presets live in the picker permanently and apply the mapped subset', async () => {
      const user = userEvent.setup()
      mockAvailableDataSources = [
        { id: 'web_search', name: 'Web Search' },
        { id: 'ris', name: 'RIS – Österreichisches Recht' },
      ]
      mockEnabledDataSourceIds = ['web_search', 'ris']
      mockConversationMessages = [
        { id: 'msg-1', role: 'user', content: 'Hello', messageType: 'user' },
      ]

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      await user.click(screen.getByRole('button', { name: /data basis/i }))
      await user.click(screen.getByRole('radio', { name: /building law & guidelines/i }))

      expect(mockApplySourcePreset).toHaveBeenCalledWith('law', ['ris'])
      expect(mockSaveDataSourcesToConversation).toHaveBeenCalledWith(['ris'])
    })

    test.skip('"All sources" makes the default all-on state a named choice', async () => {
      const user = userEvent.setup()
      mockActiveSourcePreset = 'law'
      mockAvailableDataSources = [
        { id: 'web_search', name: 'Web Search' },
        { id: 'ris', name: 'RIS – Österreichisches Recht' },
      ]
      mockEnabledDataSourceIds = ['ris']

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      await user.click(screen.getByRole('button', { name: /data basis/i }))
      await user.click(screen.getByRole('radio', { name: /^all sources$/i }))

      expect(mockApplySourcePreset).toHaveBeenCalledWith(null, ['web_search', 'ris'])
      expect(mockSaveDataSourcesToConversation).toHaveBeenCalledWith(['web_search', 'ris'])
    })

    test('shows a stop button while streaming and cancels via stopStreaming (C1)', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)

      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument()
      const stop = screen.getByRole('button', { name: /stop response/i })
      await user.click(stop)
      expect(mockStopStreaming).toHaveBeenCalledTimes(1)
    })

    test('send and stop are one control: the same element changes job, label and glyph', () => {
      const { rerender } = render(<InputArea isAuthenticated={true} connectionMode="sse" />)
      const send = screen.getByRole('button', { name: /send message/i })
      expect(send.querySelector('[data-glyph="send"]')).not.toBeNull()
      expect(send).not.toHaveAttribute('aria-keyshortcuts')

      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      rerender(<InputArea isAuthenticated={true} connectionMode="sse" canCollaborate={false} />)

      const stop = screen.getByRole('button', { name: /stop response/i })
      expect(stop).toBe(send)
      expect(stop).toHaveAttribute('aria-keyshortcuts', 'Escape')
      expect(stop).toHaveAttribute('title', 'Stop response (Esc)')
      expect(stop.querySelector('[data-glyph="stop"]')).not.toBeNull()
      expect(stop).not.toHaveTextContent('...')
    })

    test('Escape stops a streaming turn from <body> once the composer let go of the focus', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const input = screen.getByRole('textbox')
      act(() => input.focus())
      act(() => input.blur())
      expect(document.activeElement).toBe(document.body)
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).toHaveBeenCalledTimes(1)
    })

    test('Escape from <body> after a click on transcript text leaves the turn running', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(
        <>
          <p>Antworttext</p>
          <InputArea isAuthenticated={true} connectionMode="sse" />
        </>
      )

      await user.click(screen.getByRole('textbox'))
      await user.click(screen.getByText('Antworttext'))
      expect(document.activeElement).toBe(document.body)
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test('Escape from <body> with the composer never used leaves the turn running', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(document.activeElement).toBe(document.body)
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test("an IME's Escape (Safari: after compositionend, keyCode 229) leaves the turn running", () => {
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      const input = screen.getByRole('textbox')
      act(() => input.focus())
      fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test('Escape meant for something else on the page leaves the turn running', async () => {
      const user = userEvent.setup()
      mockIsStreaming = true
      vi.mocked(useIsCurrentSessionBusy).mockReturnValue(true)
      render(
        <>
          <input aria-label="elsewhere" />
          <InputArea isAuthenticated={true} connectionMode="sse" />
        </>
      )

      await user.click(screen.getByRole('textbox', { name: 'elsewhere' }))
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test('Escape does nothing to the turn when nothing is streaming', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      await user.click(screen.getByRole('textbox'))
      await user.keyboard('{Escape}')
      expect(mockStopStreaming).not.toHaveBeenCalled()
    })

    test('nothing in the composer offers to choose deep research', () => {
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(
        screen.queryByRole('button', { name: /deep research preference/i })
      ).not.toBeInTheDocument()
    })

    test('offers no project scope chip: the project is fixed, so a picker would be a dead control', () => {
      render(<InputArea isAuthenticated={true} connectionMode="sse" />)

      expect(screen.queryByRole('button', { name: /search scope/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /all projects/i })).not.toBeInTheDocument()
    })

  })
})
