import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { RailChatList, type RailChats } from './rail-chats'

const chats = (over: Partial<RailChats> = {}): RailChats => ({
  items: [{ id: 'c1', title: 'Stellplatznachweis', href: '/app/projects/p1/chat?session=c1', current: false }],
  allHref: '/app/projects/p1/chat',
  ...over,
})

describe('RailChatList — the menu at each chat', () => {
  test('renames the chat in place, and keeps the old name on Escape', async () => {
    const onRename = vi.fn()
    const user = userEvent.setup()
    render(<RailChatList chats={chats({ onRename })} pillId="pill" />)

    await user.click(screen.getByTestId('rail-chat-menu'))
    await user.click(await screen.findByTestId('rail-chat-rename'))
    const input = await screen.findByTestId('rail-chat-rename-input')
    await user.clear(input)
    await user.type(input, 'Garage{Enter}')

    expect(onRename).toHaveBeenCalledWith('c1', 'Garage')

    await user.click(screen.getByTestId('rail-chat-menu'))
    await user.click(await screen.findByTestId('rail-chat-rename'))
    await user.type(await screen.findByTestId('rail-chat-rename-input'), 'x{Escape}')

    expect(onRename).toHaveBeenCalledTimes(1)
  })

  test('hands a delete to its source, which asks first', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(<RailChatList chats={chats({ onDelete })} pillId="pill" />)

    await user.click(screen.getByTestId('rail-chat-menu'))
    await user.click(await screen.findByTestId('rail-chat-delete'))

    expect(onDelete).toHaveBeenCalledWith('c1')
  })

  test('a list that can do neither has no menu', () => {
    render(<RailChatList chats={chats()} pillId="pill" />)

    expect(screen.queryByTestId('rail-chat-menu')).not.toBeInTheDocument()
  })

  test('a chat that is still answering can be neither renamed nor deleted', async () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const user = userEvent.setup()
    const busy = chats({ onRename, onDelete })
    busy.items[0]!.activity = 'working'
    render(<RailChatList chats={busy} pillId="pill" />)

    await user.click(screen.getByTestId('rail-chat-menu'))

    expect(await screen.findByTestId('rail-chat-rename')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('rail-chat-delete')).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('RailChatList — a chat on its way to a name, and a list on its way from the server', () => {
  const provisional = (over: Partial<RailChats['items'][number]> = {}): RailChats =>
    chats({ items: [{ id: 'c1', title: 'Wie viele Stellplätze', provisional: true, href: '/app/personal/chat?session=c1', current: true, ...over }] })

  test('the first line stands in a quieter ink until the name arrives, then the name takes the same row', () => {
    const { rerender } = render(<RailChatList chats={provisional()} pillId="pill" />)
    const link = screen.getByRole('link', { name: 'Wie viele Stellplätze' })
    const title = link.querySelector('[data-provisional]')
    expect(title).toHaveClass('text-subtle', 'truncate')

    rerender(<RailChatList chats={provisional({ title: 'Stellplatznachweis', provisional: false })} pillId="pill" />)

    const named = screen.getByRole('link', { name: 'Stellplatznachweis' })
    expect(named).toBe(link)
    expect(named.querySelector('[data-provisional]')).toBeNull()
    expect(named).toHaveClass('h-8')
  })

  test('a first message without words shows a short pending title, named for screen readers', () => {
    render(<RailChatList chats={provisional({ title: '' })} pillId="pill" />)
    expect(screen.getByTestId('rail-chat-title-pending').querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New chat' })).toBeInTheDocument()
  })

  test('while the side’s first listing loads, skeleton rows fill up to three, even before any chat', () => {
    const { rerender } = render(<RailChatList chats={chats({ items: [], loading: true })} pillId="pill" />)
    expect(screen.getByRole('list', { name: 'Recent chats' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByTestId('rail-chat-pending')).toHaveLength(3)

    rerender(<RailChatList chats={chats({ loading: true })} pillId="pill" />)
    expect(screen.getAllByTestId('rail-chat-pending')).toHaveLength(2)

    rerender(<RailChatList chats={chats()} pillId="pill" />)
    expect(screen.queryByTestId('rail-chat-pending')).toBeNull()
  })

  test('nothing to list and nothing loading: no section at all', () => {
    const { container } = render(<RailChatList chats={chats({ items: [] })} pillId="pill" />)
    expect(container).toBeEmptyDOMElement()
  })

  test('a row stays lit while its menu is open or the pointer rests on the menu button', () => {
    render(<RailChatList chats={chats({ onDelete: vi.fn() })} pillId="pill" />)
    expect(screen.getByRole('link', { name: 'Stellplatznachweis' })).toHaveClass(
      'text-muted-foreground',
      'group-hover/chat:bg-selected',
      'group-has-[[data-state=open]]/chat:bg-selected'
    )
  })
})
