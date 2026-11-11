/**
 * The thread holds at most one unresolved connection error: a second
 * `connection.failed` or `connection.lost` takes the place of the first, and
 * a socket that opens again clears the one there is. Every other error kind
 * is appended as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../store'
import type { ChatMessage, Conversation } from '../types'

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: {
    getState: () => ({ enabledDataSourceIds: [], availableDataSources: [], setEnabledDataSources: vi.fn() }),
  },
}))

vi.mock('@/adapters/api/conversations-client', () => ({
  conversationsClient: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
    createMessage: vi.fn().mockResolvedValue(undefined),
    createMessages: vi.fn().mockResolvedValue(undefined),
    listMessages: vi.fn().mockResolvedValue([]),
  },
}))

const QUESTION: ChatMessage = {
  id: 'question',
  role: 'user',
  content: 'Wie hoch darf die Brüstung sein?',
  timestamp: new Date('2026-11-11T09:00:00.000Z'),
  messageType: 'user',
}

const conversation: Conversation = {
  id: 'conv_1',
  userId: 'user-1',
  title: 'Brüstung',
  messages: [QUESTION],
  createdAt: new Date('2026-11-11T09:00:00.000Z'),
  updatedAt: new Date('2026-11-11T09:00:00.000Z'),
}

const errorCodes = (): (string | undefined)[] =>
  (useChatStore.getState().currentConversation?.messages ?? [])
    .filter((message) => message.messageType === 'error')
    .map((message) => message.errorData?.errorCode)

beforeEach(() => {
  useChatStore.setState({ currentConversation: conversation, conversations: [conversation] })
})

describe('one live connection error per conversation', () => {
  it('keeps one when the same give-up is added twice', () => {
    const { addErrorCard } = useChatStore.getState()
    addErrorCard('connection.failed')
    addErrorCard('connection.failed')
    expect(errorCodes()).toEqual(['connection.failed'])
  })

  it('replaces a lost connection with a failed one in its place, and the list holds the same thread', () => {
    const { addErrorCard } = useChatStore.getState()
    addErrorCard('connection.lost')
    addErrorCard('agent.response_interrupted')
    addErrorCard('connection.failed')
    expect(errorCodes()).toEqual(['connection.failed', 'agent.response_interrupted'])
    const state = useChatStore.getState()
    expect(state.conversations[0].messages).toEqual(state.currentConversation?.messages)
    expect(state.currentConversation?.messages[0]).toBe(QUESTION)
  })

  it('adds a new one once the last was resolved by a socket that opened', () => {
    const { addErrorCard, dismissConnectionErrors } = useChatStore.getState()
    addErrorCard('connection.failed')
    dismissConnectionErrors()
    expect(errorCodes()).toEqual([])
    addErrorCard('connection.lost')
    expect(errorCodes()).toEqual(['connection.lost'])
  })

  it('adds a new one once the last was dismissed by the reader', () => {
    const { addErrorCard, dismissErrorCard } = useChatStore.getState()
    addErrorCard('connection.failed')
    const first = useChatStore.getState().currentConversation?.messages.at(-1)
    dismissErrorCard(first?.id ?? '')
    addErrorCard('connection.failed')
    expect(errorCodes()).toEqual(['connection.failed'])
  })

  it('does not deduplicate any other error kind', () => {
    const { addErrorCard } = useChatStore.getState()
    addErrorCard('agent.response_interrupted')
    addErrorCard('agent.response_interrupted')
    addErrorCard('connection.server_incompatible')
    addErrorCard('connection.server_incompatible')
    expect(errorCodes()).toEqual([
      'agent.response_interrupted',
      'agent.response_interrupted',
      'connection.server_incompatible',
      'connection.server_incompatible',
    ])
  })
})
