import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { useChatStore } from './store'
import { readStoredChat } from './stores/chat-storage'
import type { Conversation } from './types'
import { PRODUCT_NAME } from '@/lib/brand'
import { STORAGE_KEY } from './store.fixtures'

const mockLayoutState = vi.hoisted(() => ({
  enabledDataSourceIds: ['web_search'],
  availableDataSources: [{ id: 'web_search' }, { id: 'knowledge_base', requires_auth: true }],
  setEnabledDataSources: vi.fn(),
}))

const mockDiscardSessionResources = vi.hoisted(() => vi.fn())

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: {
    getState: () => mockLayoutState,
  },
}))

vi.mock('@/features/documents/discard-session-resources', () => ({
  discardSessionDocumentsResources: mockDiscardSessionResources,
}))

const mockConversationsClient = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(undefined),
  create: vi.fn().mockResolvedValue(undefined),
  updateTitle: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  listMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue(undefined),
  createMessages: vi.fn().mockResolvedValue(undefined),
  newestFrameAge: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/adapters/api/conversations-client', () => ({
  conversationsClient: mockConversationsClient,
}))

describe('useChatStore', () => {
  beforeEach(() => {
    useChatStore.persist.clearStorage()
    mockLayoutState.setEnabledDataSources.mockClear()
    mockLayoutState.enabledDataSourceIds = ['web_search']
    mockLayoutState.availableDataSources = [
      { id: 'web_search' },
      { id: 'knowledge_base', requires_auth: true },
    ]
    mockDiscardSessionResources.mockClear()
    useChatStore.setState({
      currentUserId: null,
      currentConversation: null,
      conversations: [],
      projectId: null,
      isStreaming: false,
      isLoading: false,
      currentUserMessageId: null,
      pendingInteraction: null,
      composerPrefill: null,
      composerSubject: null,
      composerDrafts: {},
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    useChatStore.persist.clearStorage()
  })

  describe('composer prefill', () => {
    test('starts empty', () => {
      expect(useChatStore.getState().composerPrefill).toBeNull()
    })

    test('setComposerPrefill queues text for the composer', () => {
      useChatStore.getState().setComposerPrefill('Ask about OIB 2 fire resistance')

      expect(useChatStore.getState().composerPrefill).toEqual({
        text: 'Ask about OIB 2 fire resistance',
      })
    })

    test('setComposerPrefill carries structured mentions alongside the text', () => {
      useChatStore
        .getState()
        .setComposerPrefill(`@${PRODUCT_NAME} `, [{ targetId: 'agent:piloti', display: PRODUCT_NAME }])

      expect(useChatStore.getState().composerPrefill).toEqual({
        text: `@${PRODUCT_NAME} `,
        mentions: [{ targetId: 'agent:piloti', display: PRODUCT_NAME }],
      })
    })

    test('consumeComposerPrefill returns the queued text and clears it (one-shot)', () => {
      useChatStore.getState().setComposerPrefill('Draft question')

      const first = useChatStore.getState().consumeComposerPrefill()
      const second = useChatStore.getState().consumeComposerPrefill()

      expect(first).toEqual({ text: 'Draft question' })
      expect(second).toBeNull()
      expect(useChatStore.getState().composerPrefill).toBeNull()
    })

    test('consumeComposerPrefill returns null when nothing is queued', () => {
      expect(useChatStore.getState().consumeComposerPrefill()).toBeNull()
    })

    test('consumeComposerPrefill preserves an empty-string prefill as a distinct value', () => {
      useChatStore.getState().setComposerPrefill('')

      expect(useChatStore.getState().consumeComposerPrefill()).toEqual({ text: '' })
      expect(useChatStore.getState().consumeComposerPrefill()).toBeNull()
    })
  })

  describe('composer drafts (per-session)', () => {
    test('starts empty', () => {
      expect(useChatStore.getState().composerDrafts).toEqual({})
      expect(useChatStore.getState().getComposerDraft('conv-1')).toBe('')
    })

    test('setComposerDraft saves in-progress text per session id', () => {
      useChatStore.getState().setComposerDraft('conv-1', 'half typed question')

      expect(useChatStore.getState().getComposerDraft('conv-1')).toBe('half typed question')
      expect(useChatStore.getState().composerDrafts).toEqual({ 'conv-1': 'half typed question' })
    })

    test('keeps drafts isolated per session (two sessions keep separate drafts)', () => {
      useChatStore.getState().setComposerDraft('conv-1', 'draft for one')
      useChatStore.getState().setComposerDraft('conv-2', 'draft for two')

      expect(useChatStore.getState().getComposerDraft('conv-1')).toBe('draft for one')
      expect(useChatStore.getState().getComposerDraft('conv-2')).toBe('draft for two')
    })

    test('setComposerDraft with empty string drops the entry (no orphan blank drafts)', () => {
      useChatStore.getState().setComposerDraft('conv-1', 'something')
      useChatStore.getState().setComposerDraft('conv-1', '')

      expect(useChatStore.getState().getComposerDraft('conv-1')).toBe('')
      expect('conv-1' in useChatStore.getState().composerDrafts).toBe(false)
    })

    test('clearComposerDraft removes exactly one session draft', () => {
      useChatStore.getState().setComposerDraft('conv-1', 'draft for one')
      useChatStore.getState().setComposerDraft('conv-2', 'draft for two')

      useChatStore.getState().clearComposerDraft('conv-1')

      expect(useChatStore.getState().getComposerDraft('conv-1')).toBe('')
      expect(useChatStore.getState().getComposerDraft('conv-2')).toBe('draft for two')
    })

    test('persists drafts to localStorage so a reload restores them', async () => {
      useChatStore.setState({ currentUserId: 'user-1' })
      useChatStore.getState().setComposerDraft('conv-1', 'survives reload')

      await vi.waitFor(() => {
        const parsed = readStoredChat(STORAGE_KEY)!
        expect(parsed).not.toBeNull()
        expect(parsed.state.composerDrafts).toEqual({ 'conv-1': 'survives reload' })
      })
    })

    test('deleteConversation drops the deleted session draft', () => {
      const conv: Conversation = {
        id: 'conv-1',
        userId: 'user-1',
        title: 'Test',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      useChatStore.setState({
        currentUserId: 'user-1',
        currentConversation: conv,
        conversations: [conv],
      })
      useChatStore.getState().setComposerDraft('conv-1', 'draft to drop')
      useChatStore.getState().setComposerDraft('conv-2', 'keep me')

      useChatStore.getState().deleteConversation('conv-1')

      expect('conv-1' in useChatStore.getState().composerDrafts).toBe(false)
      expect(useChatStore.getState().getComposerDraft('conv-2')).toBe('keep me')
    })
  })
})
