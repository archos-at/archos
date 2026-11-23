import { act, render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { ComposerExcerpt, ComposerPrefill, ComposerSubject } from '@/features/chat/types'
import { InputArea } from './InputArea'
import { ChatDropZone } from './chat-drop-zone'
import { bumpThreadRevision, publishThreadSharing, resetThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useAwaitingState } from '@/features/collaboration/hooks/use-sharing'
import { useWebSocketChat, useIsCurrentSessionBusy } from '@/features/chat'
import { useFileUpload, useFileDragDrop } from '@/features/documents'
import { PRODUCT_NAME } from '@/lib/brand'
import { AGENT_CANDIDATE, ANNA_CANDIDATE, MARKUS_CANDIDATE } from './input-area.fixtures'

vi.mock('@/shared/collaboration/thread-sharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/collaboration/thread-sharing')>()),
  bumpThreadRevision: vi.fn(),
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
let mockComposerExcerpt: ComposerExcerpt | null = null
const mockSetComposerExcerpt = vi.fn((next: ComposerExcerpt | null) => {
  mockComposerExcerpt = next
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
    composerExcerpt: mockComposerExcerpt,
    setComposerExcerpt: mockSetComposerExcerpt,
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
    mockComposerExcerpt = null
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

  describe('the send agrees with the addressee line', () => {
    const composer = () => screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)

    const send = async (text: string) => {
      const user = userEvent.setup()
      await user.click(composer())
      await user.keyboard(text)
      await user.click(screen.getByRole('button', { name: /send message/i }))
    }

    test('a plain message while a person is awaited asks the server to rule', async () => {
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await send('Ja, eigener Abschnitt.')

      expect(mockSendMessage).toHaveBeenCalledWith('Ja, eigener Abschnitt.', {
        awaitingHuman: true,
      })
    })

    test('a plain message in the normal state stays the one-argument fast path', async () => {
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await send('Wie breit muss der Fluchtweg sein?')

      expect(mockSendMessage).toHaveBeenCalledWith('Wie breit muss der Fluchtweg sein?')
    })

    test('a message about a selected part of an answer sends that part and takes it out of the composer', async () => {
      mockComposerExcerpt = { conversationId: 'session-1', messageId: 'a1', text: 'höchstens 40 m' }
      mockSendMessage.mockReturnValue(true)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)
      expect(screen.getByTestId('composer-answer-excerpt')).toHaveTextContent('höchstens 40 m')

      await send('Woher kommt das?')

      expect(mockSendMessage).toHaveBeenCalledWith('Woher kommt das?', {
        answerExcerpt: { messageId: 'a1', text: 'höchstens 40 m' },
      })
      await waitFor(() => expect(mockSetComposerExcerpt).toHaveBeenCalledWith(null))
    })

    test('a part selected in another conversation is neither shown nor sent', async () => {
      mockComposerExcerpt = { conversationId: 'session-2', messageId: 'a1', text: 'höchstens 40 m' }
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)
      expect(screen.queryByTestId('composer-answer-excerpt')).not.toBeInTheDocument()

      await send('Wie breit muss der Fluchtweg sein?')

      expect(mockSendMessage).toHaveBeenCalledWith('Wie breit muss der Fluchtweg sein?')
    })

    test('a gated org never takes the ruled path, wait or no wait (NF-8)', async () => {
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated connectionMode="sse" />)

      const user = userEvent.setup()
      await user.click(screen.getByRole('textbox'))
      await user.keyboard('Frage')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      expect(mockSendMessage).toHaveBeenCalledWith('Frage')
    })

    test('asks the awaiting endpoint nothing at all on a thread that is not shared (NF-8)', () => {
      mockAwaitingPending = [{ id: 'r-1' }]
      publishThreadSharing('session-1', false)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(vi.mocked(useAwaitingState)).toHaveBeenCalledWith(null, false)
    })

    test('asks it once the thread IS shared', () => {
      publishThreadSharing('session-1', true)
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      expect(vi.mocked(useAwaitingState)).toHaveBeenCalledWith('session-1', true)
    })

    test('declares the thread stale after sending a mention', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('@anna')
      await screen.findByTestId('mention-picker')
      await user.keyboard('{Enter}')
      await user.keyboard('schaust du drauf?')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() => expect(vi.mocked(bumpThreadRevision)).toHaveBeenCalledWith('session-1'))
    })

    test('…and not after an ordinary message, which changes nothing server-side', async () => {
      const user = userEvent.setup()
      render(<InputArea isAuthenticated canCollaborate connectionMode="sse" />)

      await user.click(composer())
      await user.keyboard('Kurze Frage')
      await user.click(screen.getByRole('button', { name: /send message/i }))

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(vi.mocked(bumpThreadRevision)).not.toHaveBeenCalled()
    })
  })

  describe('attaching to a chat that has no server row yet', () => {
    test('makes the conversation real before the bytes, then uploads into the chat', async () => {
      const order: string[] = []
      mockEnsureConversationExists.mockImplementationOnce(async () => {
        order.push('ensureConversation')
      })
      mockUploadFiles.mockImplementationOnce(async () => {
        order.push('upload')
      })

      render(
        <ChatDropZone>
          <InputArea isAuthenticated={true} />
        </ChatDropZone>
      )
      const { onDrop } = vi.mocked(useFileDragDrop).mock.calls.at(-1)![0]
      await act(async () => {
        await onDrop([new File(['x'], 'plan.pdf', { type: 'application/pdf' })], { truncated: false, unreadable: 0 })
      })

      expect(order).toEqual(['ensureConversation', 'upload'])
      expect(mockUploadFiles).toHaveBeenCalledWith(expect.any(Array), { collectionOverride: 'session-1' })
      expect(vi.mocked(useFileUpload)).toHaveBeenCalledWith(
        expect.objectContaining({ collectionName: 'session-1', conversationProjectId: undefined })
      )
      expect(vi.mocked(useFileUpload).mock.calls[0][0]).toHaveProperty('conversationProjectId')
    })
  })

  describe('a message asked while its file is still being read', () => {
    const composer = () => screen.getByPlaceholderText(`Ask ${PRODUCT_NAME} about this project …`)

    const withSessionFiles = (files: unknown[]) =>
      vi.mocked(useFileUpload).mockReturnValue({
        uploadFiles: mockUploadFiles,
        deleteFile: mockDeleteFile,
        retryFile: mockRetryFile,
        sessionFiles: files,
        isUploading: false,
        error: null,
        clearError: vi.fn(),
      } as unknown as ReturnType<typeof useFileUpload>)

    const ingesting = [
      { id: 'file-1', fileName: 'grundriss.pdf', status: 'ingesting', collectionName: 'session-1' },
    ]
    const ready = [
      { id: 'file-1', fileName: 'grundriss.pdf', status: 'success', collectionName: 'session-1' },
    ]

    test('is held rather than sent, and says so', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Erfüllt der Grundriss die Fluchtweganforderungen?{Enter}')

      expect(mockSendMessage).not.toHaveBeenCalled()
      expect(screen.getByTestId('composer-held-for-upload')).toBeInTheDocument()
    })

    test('goes on its own the moment the file is readable', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      const { rerender } = render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Wie hoch ist die Attika?{Enter}')
      expect(mockSendMessage).not.toHaveBeenCalled()

      withSessionFiles(ready)
      rerender(<InputArea isAuthenticated={true} placeholder={undefined} />)

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(String(mockSendMessage.mock.calls[0]?.[0])).toBe('Wie hoch ist die Attika?')
      await waitFor(() => expect(screen.queryByTestId('composer-held-for-upload')).not.toBeInTheDocument())
    })

    test('is not swallowed by an upload that failed', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      const { rerender } = render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Und ohne die Datei?{Enter}')

      withSessionFiles([{ ...ingesting[0], status: 'error' }])
      rerender(<InputArea isAuthenticated={true} placeholder={undefined} />)

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
    })

    test('offers a way to ask now without waiting', async () => {
      const user = userEvent.setup()
      withSessionFiles(ingesting)
      render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Was gilt allgemein?{Enter}')

      await user.click(screen.getByRole('button', { name: /ask now without it/i }))

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(String(mockSendMessage.mock.calls[0]?.[0])).toBe('Was gilt allgemein?')
    })

    test('sends immediately when nothing is in flight', async () => {
      const user = userEvent.setup()
      withSessionFiles(ready)
      render(<InputArea isAuthenticated={true} />)

      await user.click(composer())
      await user.keyboard('Ganz normale Frage{Enter}')

      await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
      expect(screen.queryByTestId('composer-held-for-upload')).not.toBeInTheDocument()
    })
  })

})
