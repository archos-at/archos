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

  test('while the server has not confirmed a switch, the line says it is being switched, never that nothing is kept', () => {
    const { rerender } = render(<ConversationPrivacyLineView temporary="turningOn" privateToReader={false} />)
    expect(screen.getByTestId('conversation-temporary-line')).toHaveTextContent('Turning on temporary chat …')
    expect(screen.getByTestId('conversation-temporary-line')).not.toHaveTextContent('keeps nothing')
    rerender(<ConversationPrivacyLineView temporary="turningOff" privateToReader={false} />)
    expect(screen.getByTestId('conversation-temporary-line')).toHaveTextContent('Turning off temporary chat …')
  })

  test('a private chat says only the reader sees it until they share it', () => {
    render(<ConversationPrivacyLineView temporary={false} privateToReader />)
    expect(screen.getByTestId('conversation-privacy-line')).toHaveClass('sm:hidden')
    expect(screen.getByTestId('conversation-private-line')).toHaveTextContent('Only you see this chat until you share it.')
  })
})

describe('ConversationPrivacyLineView in a started chat', () => {
  test('keeps its row while the chat is not temporary, so switching it on does not lift the composer', () => {
    render(<ConversationPrivacyLineView temporary={false} privateToReader={false} reserved />)
    const line = screen.getByTestId('conversation-privacy-line')
    expect(line).not.toHaveClass('sm:hidden')
    expect(screen.queryByTestId('conversation-temporary-line')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  test('every statement stands in the one cell and only the current one is shown, so the row is as tall in each', () => {
    const { rerender } = render(<ConversationPrivacyLineView temporary="turningOn" privateToReader reserved />)
    const layers = () => Array.from(screen.getByTestId('conversation-privacy-line').querySelectorAll('[data-slot="fact-line"]'))
    expect(layers()).toHaveLength(4)
    for (const layer of layers()) expect(layer.parentElement).toHaveClass('col-start-1', 'row-start-1')
    expect(screen.getByTestId('conversation-temporary-line').parentElement).toHaveClass('opacity-100')
    expect(screen.getByTestId('conversation-private-line').parentElement).toHaveClass('opacity-0')
    expect(screen.getByRole('status')).toHaveTextContent('Turning on temporary chat …')

    rerender(<ConversationPrivacyLineView temporary={false} privateToReader reserved />)
    expect(layers()).toHaveLength(4)
    expect(screen.getByTestId('conversation-private-line').parentElement).toHaveClass('opacity-100')
  })
})

describe('ConversationPrivacyLine', () => {
  test('on a new chat, before the server has answered, the row is kept but claims nothing, so starting the chat never grows the composer', () => {
    open(conversation())
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate statesTemporary={false} />)
    expect(screen.getByTestId('conversation-privacy-line')).toBeInTheDocument()
    expect(screen.getByTestId('conversation-privacy-line')).not.toHaveClass('sm:hidden')
    expect(screen.queryByTestId('conversation-private-line')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conversation-temporary-line')).not.toBeInTheDocument()
  })

  test('in a started chat, before the server has answered, the row is kept but claims nothing about access', () => {
    open(conversation())
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate />)
    expect(screen.getByTestId('conversation-privacy-line')).toBeInTheDocument()
    expect(screen.queryByTestId('conversation-private-line')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conversation-temporary-line')).not.toBeInTheDocument()
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

  test('on a new chat the welcome says it, so the line under the composer stays out and the composer never moves', () => {
    open(conversation({ temporary: true }))
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate={false} statesTemporary={false} />)
    expect(screen.queryByTestId('conversation-temporary-line')).not.toBeInTheDocument()
  })

  test('the temporary line goes when the conversation is switched back', () => {
    open(conversation({ temporary: true }))
    render(<ConversationPrivacyLine conversationId="c-1" canCollaborate={false} />)
    expect(screen.getByTestId('conversation-temporary-line')).toBeInTheDocument()
    open(conversation({ temporary: false }))
    expect(screen.queryByTestId('conversation-temporary-line')).not.toBeInTheDocument()
  })
})
