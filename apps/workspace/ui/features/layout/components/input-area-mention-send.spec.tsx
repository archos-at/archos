import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { toast } from 'sonner'
import type { ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { resetThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useMentionCandidates } from '@/features/collaboration/hooks/use-sharing'
import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useFileUpload, useFileDragDrop } from '@/features/documents'
import { PRODUCT_NAME } from '@/lib/brand'
import { AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE } from './input-area.fixtures'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

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

  describe('@-mentions', () => {
    const composer = () => screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)

    test('once a human is tagged the composer says the agent will stay quiet', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(screen.getByTestId('composer-mention-hint')).toHaveTextContent(
        `${PRODUCT_NAME} will stay quiet — Anna Weber is being asked.`,
      )
    })

    test('tagging only the assistant does not claim it will stay quiet', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard(`@${PRODUCT_NAME.slice(0, 3).toLowerCase()}`)
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')

      expect(composer()).toHaveValue(`@${PRODUCT_NAME} `)
      expect(screen.queryByTestId('composer-mention-hint')).not.toBeInTheDocument()
    })

    test('sending passes the STRUCTURED mentions, not the text', async () => {
      const user = userEvent.setup()
      mockSendMessage.mockResolvedValue({ ok: true, addressees: { agent: false, users: ['u-anna'] } })
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.keyboard('passt das?')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      expect(mockSendMessage).toHaveBeenCalledWith('@Anna Weber passt das?', {
        mentions: [{ targetId: 'u-anna', display: 'Anna Weber' }],
      })
      expect(composer()).toHaveValue('')
      expect(screen.queryByTestId('composer-mention-hint')).not.toBeInTheDocument()
    })

    test('deleting the inserted token deletes the mention (MN-3)', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      expect(screen.getByTestId('composer-mention-hint')).toBeInTheDocument()

      await user.clear(composer())
      await user.keyboard('doch nicht, danke')
      expect(screen.queryByTestId('composer-mention-hint')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /send message/i }))
      expect(mockSendMessage).toHaveBeenCalledWith('doch nicht, danke')
    })

    test('a refused mention keeps the text and explains the refusal', async () => {
      const user = userEvent.setup()
      mockSendMessage.mockResolvedValue({
        ok: false,
        failure: { reason: 'mention-invite-requires-owner', message: 'refused' },
      })
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() => expect(composer()).toHaveValue('@Anna Weber'))
      expect(screen.getByTestId('composer-mention-hint')).toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith(
        'You can only mention people who are already in this conversation. Ask an owner to invite Anna Weber.',
        expect.anything(),
      )
    })

    test('a rate-limited mention says so', async () => {
      const user = userEvent.setup()
      mockSendMessage.mockResolvedValue({
        ok: false,
        failure: { reason: 'mention-rate-limited', message: null },
      })
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Too many mentions. Please wait a few minutes.',
          expect.anything(),
        ),
      )
    })

    test('without a candidate list the composer behaves exactly as before (NF-8)', async () => {
      const user = userEvent.setup()
      mockMentionData = null
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')

      expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
      expect(composer()).not.toHaveAttribute('role')

      await user.keyboard('{Enter}')
      expect(mockSendMessage).toHaveBeenCalledWith('@anna')
    })

    test('while the candidates load the picker shows its skeleton rows', async () => {
      const user = userEvent.setup()
      mockMentionData = null
      mockMentionsLoading = true
      render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@')

      expect(await screen.findByTestId('mention-picker')).toBeInTheDocument()
      expect(screen.getByText('Loading people…')).toBeInTheDocument()
    })

    describe('when the candidates never arrived', () => {
      test('a fresh @ asks again', async () => {
        const user = userEvent.setup()
        mockMentionData = null
        mockMentionsLoading = false
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')
        mockRestartMentionCandidates.mockClear()

        await user.keyboard('{Backspace}Frage an @')

        expect(mockRestartMentionCandidates).toHaveBeenCalled()
      })

      test('but typing inside one fragment does not ask once per keystroke', async () => {
        const user = userEvent.setup()
        mockMentionData = null
        mockMentionsLoading = false
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')
        mockRestartMentionCandidates.mockClear()

        await user.keyboard('Markus')

        expect(mockRestartMentionCandidates).not.toHaveBeenCalled()
      })

      test('and a picker that already has its candidates is left alone', async () => {
        const user = userEvent.setup()
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')
        mockRestartMentionCandidates.mockClear()
        await user.keyboard('{Backspace}Frage an @')

        expect(mockRestartMentionCandidates).not.toHaveBeenCalled()
      })

      test('makes the conversation real on the first @ of a new window', async () => {
        const user = userEvent.setup()
        mockCurrentSessionId = null
        mockMentionData = null
        mockMentionsLoading = false
        mockEnsureConversationExists.mockClear()
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@')

        expect(mockEnsureConversationExists).toHaveBeenCalled()
      })

      test('does not pay the round trip on every keystroke, only on the fragment', async () => {
        const user = userEvent.setup()
        mockCurrentSessionId = null
        mockMentionData = null
        mockMentionsLoading = false
        render(<InputArea isAuthenticated={true} canCollaborate connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('Frage')
        expect(mockEnsureConversationExists).not.toHaveBeenCalled()

        await user.keyboard(' an @')
        expect(mockEnsureConversationExists).toHaveBeenCalledTimes(1)

        await user.keyboard('Markus')
        expect(mockEnsureConversationExists).toHaveBeenCalledTimes(1)
      })
    })

    describe('with collaboration off', () => {
      test('typing @ opens nothing, even while a load could be in flight', async () => {
        const user = userEvent.setup()
        mockMentionData = null
        mockMentionsLoading = true
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('Frage an @')

        expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument()
        expect(composer()).not.toHaveAttribute('role')
      })

      test('never asks the server who could be mentioned', async () => {
        const user = userEvent.setup()
        render(<InputArea isAuthenticated={true} connectionMode="sse" />)

        await user.click(composer())
        await user.keyboard('@ann')

        expect(vi.mocked(useMentionCandidates)).toHaveBeenCalled()
        for (const call of vi.mocked(useMentionCandidates).mock.calls) {
          expect(call[1]).toBe(false)
        }
      })
    })
  })
})
