import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test-utils'
import { toast } from 'sonner'
import { publishThreadRole, resetThreadSharing } from '@/shared/collaboration/thread-sharing'
import { markConversationMinted, resetConversationsOnServer } from '../../lib/conversation-on-server'
import { resetTemporarySettling } from '../../lib/temporary-conversation'
import { resetCreatedTemporary } from '../../lib/temporary-created'
import { useChatStore } from '../../store'
import type { Conversation } from '../../types'
import { TemporaryChatToggle, TemporaryChatToggleView } from './TemporaryChatToggle'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c-1',
  userId: 'u-1',
  title: 'Brandschutz',
  messages: [],
  createdAt: new Date('2026-11-10T08:00:00Z'),
  updatedAt: new Date('2026-11-10T08:00:00Z'),
  ...overrides,
})

const open = (current: Conversation | null): void => {
  act(() => useChatStore.setState({ currentConversation: current, conversations: current ? [current] : [] }))
}

const fetchMock = vi.fn()
const toggle = (): HTMLElement => screen.getByTestId('temporary-chat-toggle')
const stored = (): boolean | undefined => useChatStore.getState().currentConversation?.temporary

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(toast.error).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  act(() => {
    resetThreadSharing()
    resetConversationsOnServer()
    resetTemporarySettling()
    resetCreatedTemporary()
    useChatStore.setState({ currentConversation: null, conversations: [], currentUserId: null })
  })
})

describe('TemporaryChatToggle', () => {
  test('a stored chat is switched with one PATCH, and the store takes the server’s answer', async () => {
    open(conversation())
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'c-1', temporary: true }))
    render(<TemporaryChatToggle conversationId="c-1" />)
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(toggle())

    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'true'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/c-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temporary: true }),
    })
    expect(stored()).toBe(true)
  })

  test('switching it off sends false', async () => {
    open(conversation({ temporary: true }))
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'c-1', temporary: false }))
    render(<TemporaryChatToggle conversationId="c-1" />)

    await userEvent.click(toggle())

    await waitFor(() => expect(stored()).toBe(false))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ temporary: false })
  })

  test('a refusal changes nothing on screen and says who may switch', async () => {
    open(conversation())
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 404 }))
    render(<TemporaryChatToggle conversationId="c-1" />)

    await userEvent.click(toggle())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only the owner of the chat can change this.'))
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(stored()).toBeUndefined()
  })

  test('a failure changes nothing on screen and asks to try again', async () => {
    open(conversation())
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 502 }))
    render(<TemporaryChatToggle conversationId="c-1" />)

    await userEvent.click(toggle())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The setting was not saved. Try again.'))
    expect(stored()).toBeUndefined()
  })

  test('a chat the server does not hold yet keeps the choice and asks nothing', async () => {
    markConversationMinted('c-1')
    open(conversation())
    render(<TemporaryChatToggle conversationId="c-1" />)

    await userEvent.click(toggle())

    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'true'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stored()).toBe(true)
  })

  test('on the start screen the switch keeps the choice as a draft and creates no chat', async () => {
    open(null)
    act(() => useChatStore.setState({ currentUserId: 'u-1', composerTemporary: false }))
    render(<TemporaryChatToggle conversationId={null} />)

    await userEvent.click(toggle())

    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(useChatStore.getState().composerTemporary).toBe(true)
    expect(useChatStore.getState().currentConversation).toBeNull()
    expect(useChatStore.getState().conversations).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(useChatStore.getState().composerTemporary).toBe(false)
  })

  test('the owner of a shared chat gets the control', () => {
    open(conversation())
    act(() => publishThreadRole('c-1', 'owner'))
    render(<TemporaryChatToggle conversationId="c-1" />)
    expect(toggle()).toBeInTheDocument()
  })

  test.each(['collaborator', 'viewer'] as const)('a %s gets no control', (role) => {
    open(conversation({ temporary: true }))
    act(() => publishThreadRole('c-1', role))
    render(<TemporaryChatToggle conversationId="c-1" />)
    expect(screen.queryByTestId('temporary-chat-toggle')).not.toBeInTheDocument()
  })

  test('off it is the glyph alone, on it fills with ink and says „Temporär“, as the concept draws it', () => {
    open(conversation())
    const { rerender } = render(<TemporaryChatToggleView pressed={false} onPressedChange={() => undefined} />)
    expect(screen.getByTestId('temporary-chat-glyph')).toBeInTheDocument()
    expect(screen.getByTestId('temporary-chat-word')).toHaveAttribute('data-shown', 'false')
    expect(screen.getByTestId('temporary-chat-word')).toHaveClass('opacity-0')
    expect(toggle()).toHaveAccessibleName('Turn on temporary chat')
    expect(screen.getByTestId('temporary-chat-pill')).toHaveClass('group-data-[state=on]/temporary:bg-foreground')

    rerender(<TemporaryChatToggleView pressed onPressedChange={() => undefined} />)
    const word = screen.getByTestId('temporary-chat-word')
    expect(word).toHaveTextContent('Temporary')
    expect(word).toHaveAttribute('data-shown', 'true')
    expect(word).toHaveClass('opacity-100')
    expect(toggle()).toHaveAttribute('data-state', 'on')
    expect(toggle()).toHaveAccessibleName('Turn off temporary chat')
  })

  test('its box is the same pressed or not, so nothing beside it moves: the ink opens by clip-path and the glyph slides by transform', () => {
    open(conversation())
    const { rerender } = render(<TemporaryChatToggleView pressed={false} onPressedChange={() => undefined} />)
    const offBox = toggle().className
    const glyphSlot = screen.getByTestId('temporary-chat-glyph').parentElement!
    expect(glyphSlot).toHaveClass('translate-x-full')
    expect(screen.getByTestId('temporary-chat-pill').className).toMatch(/\[clip-path:inset\(0_0_0_calc\(100%-var\(--temporary-box\)/)

    rerender(<TemporaryChatToggleView pressed onPressedChange={() => undefined} />)
    expect(toggle().className).toBe(offBox)
    expect(glyphSlot).toHaveClass('translate-x-0')
    expect(screen.getByTestId('temporary-chat-pill').className).toContain('group-data-[state=on]/temporary:[clip-path:inset(0_round')
  })

  test('the ink and the glyph move on the base clock, the word follows a snap later, and all of it at once under reduced motion', () => {
    open(conversation())
    render(<TemporaryChatToggleView pressed onPressedChange={() => undefined} />)
    expect(screen.getByTestId('temporary-chat-pill')).toHaveClass('duration-base', 'ease-entrance', 'motion-reduce:transition-none')
    expect(screen.getByTestId('temporary-chat-glyph').parentElement).toHaveClass('transition-transform', 'duration-base', 'motion-reduce:transition-none')
    expect(screen.getByTestId('temporary-chat-word')).toHaveClass('delay-(--motion-snap)', 'motion-reduce:transition-none')
  })

  test('while the server confirms, it keeps the wanted state at full ink and takes no second press', async () => {
    open(conversation())
    const onPressedChange = vi.fn()
    render(<TemporaryChatToggleView pressed pending onPressedChange={onPressedChange} />)

    expect(toggle()).not.toBeDisabled()
    expect(toggle()).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(toggle())
    expect(onPressedChange).not.toHaveBeenCalled()
  })

  test('is not pressable while the composer may not contribute', () => {
    open(conversation())
    render(<TemporaryChatToggle conversationId="c-1" disabled />)
    expect(toggle()).toBeDisabled()
  })
})
