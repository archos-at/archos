/**
 * The line under the composer (ADR-0180): what is kept from this chat and who
 * reads it. Each statement appears only while it is true AND known: a guess
 * about access shown as fact is the one thing this line must never do.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { act, render, screen } from '@/test-utils'
import { PRODUCT_NAME } from '@/lib/brand'
import { publishThreadSharing, resetThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useChatStore } from '../../store'
import type { Conversation } from '../../types'
import { ConversationPrivacyLine, ConversationPrivacyLineView } from './ConversationPrivacyLine'

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c-1',
  userId: 'u-1',
  title: 'Brandschutz',
  messages: [],
  createdAt: new Date('2026-11-10T08:00:00Z'),
  updatedAt: new Date('2026-11-10T08:00:00Z'),
  ...overrides,
})

const open = (current: Conversation): void => {
  act(() => useChatStore.setState({ currentConversation: current, conversations: [current] }))
}

afterEach(() => {
  act(() => {
    resetThreadSharing()
    useChatStore.setState({ currentConversation: null, conversations: [] })
  })
})

describe('ConversationPrivacyLineView', () => {
  test('renders nothing when neither statement holds', () => {
    const { container } = render(<ConversationPrivacyLineView temporary={false} privateToReader={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('a temporary chat says the assistant keeps nothing from it', () => {
    render(<ConversationPrivacyLineView temporary privateToReader={false} />)
    expect(screen.getByTestId('conversation-temporary-line')).toHaveTextContent(
      `Temporary chat. ${PRODUCT_NAME} keeps nothing from this chat.`
    )
    expect(screen.queryByTestId('conversation-private-line')).not.toBeInTheDocument()
  })

  test('a private chat says only the reader sees it until they share it', () => {
    render(<ConversationPrivacyLineView temporary={false} privateToReader />)
    expect(screen.getByTestId('conversation-private-line')).toHaveTextContent('Private chat. You have not shared it with anyone.')
  })
})

describe('ConversationPrivacyLine', () => {
  test('says nothing about access before the server has answered', () => {
    open(conversation())
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate />)
    expect(screen.queryByTestId('conversation-privacy-line')).not.toBeInTheDocument()
  })

  test('shows the private line once the server says the thread is private', () => {
    open(conversation())
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate />)
    act(() => publishThreadSharing('c-1', false))
    expect(screen.getByTestId('conversation-private-line')).toBeInTheDocument()
  })

  test('a shared thread gets no private line', () => {
    open(conversation())
    act(() => publishThreadSharing('c-1', true))
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate />)
    expect(screen.queryByTestId('conversation-private-line')).not.toBeInTheDocument()
  })

  test('without sharing in the office nothing is claimed about access, whatever was published', () => {
    open(conversation())
    act(() => publishThreadSharing('c-1', false))
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate={false} />)
    expect(screen.queryByTestId('conversation-private-line')).not.toBeInTheDocument()
  })

  test('the temporary line follows the conversation, for a reader who cannot switch it too', () => {
    open(conversation({ temporary: true }))
    act(() => publishThreadSharing('c-1', true))
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate />)
    expect(screen.getByTestId('conversation-temporary-line')).toBeInTheDocument()
  })

  test('the temporary line goes when the conversation is switched back', () => {
    open(conversation({ temporary: true }))
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate={false} />)
    expect(screen.getByTestId('conversation-temporary-line')).toBeInTheDocument()
    open(conversation({ temporary: false }))
    expect(screen.queryByTestId('conversation-temporary-line')).not.toBeInTheDocument()
  })
})
