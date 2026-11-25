import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { railActivePillId } from './app-sidebar'
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
    render(<RailChatList chats={chats({ onRename })} />)

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
    render(<RailChatList chats={chats({ onDelete })} />)

    await user.click(screen.getByTestId('rail-chat-menu'))
    await user.click(await screen.findByTestId('rail-chat-delete'))

    expect(onDelete).toHaveBeenCalledWith('c1')
  })

  test('a list that can do neither has no menu', () => {
    render(<RailChatList chats={chats()} />)

    expect(screen.queryByTestId('rail-chat-menu')).not.toBeInTheDocument()
  })

  test('a chat that is still answering can be neither renamed nor deleted', async () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const user = userEvent.setup()
    const busy = chats({ onRename, onDelete })
    busy.items[0]!.activity = 'working'
    render(<RailChatList chats={busy} />)

    await user.click(screen.getByTestId('rail-chat-menu'))

    expect(await screen.findByTestId('rail-chat-rename')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('rail-chat-delete')).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('RailChatList — a chat on its way to a name, and a list on its way from the server', () => {
  const provisional = (over: Partial<RailChats['items'][number]> = {}): RailChats =>
    chats({ items: [{ id: 'c1', title: 'Wie viele Stellplätze', provisional: true, href: '/app/personal/chat?session=c1', current: true, ...over }] })

  test('the first line stands in a quieter ink until the name arrives, then the name takes the same row', () => {
    const { rerender } = render(<RailChatList chats={provisional()} />)
    const link = screen.getByRole('link', { name: 'Wie viele Stellplätze' })
    const title = link.querySelector('[data-provisional]')
    expect(title).toHaveClass('text-subtle', 'truncate')

    rerender(<RailChatList chats={provisional({ title: 'Stellplatznachweis', provisional: false })} />)

    const named = screen.getByRole('link', { name: 'Stellplatznachweis' })
    expect(named).toBe(link)
    expect(named.querySelector('[data-provisional]')).toBeNull()
    expect(named).toHaveClass('h-8')
  })

  test('a first line that settles without a name keeps its element: only the ink changes, nothing blinks', () => {
    const { rerender } = render(<RailChatList chats={provisional()} />)
    const before = screen.getByText('Wie viele Stellplätze')
    rerender(<RailChatList chats={provisional({ provisional: false })} />)
    const after = screen.getByText('Wie viele Stellplätze')
    expect(after).toBe(before)
    expect(after).not.toHaveAttribute('data-provisional')
    expect(after).not.toHaveClass('text-subtle')
  })

  test('a first message without words shows a short pending title, named for screen readers', () => {
    render(<RailChatList chats={provisional({ title: '' })} />)
    expect(screen.getByTestId('rail-chat-title-pending').querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New chat' })).toBeInTheDocument()
  })

  test('while the side’s first listing loads, skeleton rows fill up to three, even before any chat', () => {
    const { rerender } = render(<RailChatList chats={chats({ items: [], loading: true })} />)
    expect(screen.getByRole('list', { name: 'Recent chats' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByTestId('rail-chat-pending')).toHaveLength(3)

    rerender(<RailChatList chats={chats({ loading: true })} />)
    expect(screen.getAllByTestId('rail-chat-pending')).toHaveLength(2)

    rerender(<RailChatList chats={chats()} />)
    expect(screen.queryByTestId('rail-chat-pending')).toBeNull()
  })

  test('nothing to list and nothing loading: no section at all', () => {
    const { container } = render(<RailChatList chats={chats({ items: [] })} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('a row stays lit while its menu is open or the pointer rests on the menu button', () => {
    render(<RailChatList chats={chats({ onDelete: vi.fn() })} />)
    expect(screen.getByRole('link', { name: 'Stellplatznachweis' })).toHaveClass(
      'text-muted-foreground',
      'group-hover/chat:bg-selected',
      'group-has-[[data-state=open]]/chat:bg-selected'
    )
  })
})

describe('RailChatList — the open chat’s sheet', () => {
  test('is the list’s own, so it never slides in from the sections across the scroll box that clips it', () => {
    render(<RailChatList chats={chats({ items: [{ ...chats().items[0]!, current: true }] })} />)
    const pill = screen.getByRole('link', { name: 'Stellplatznachweis' }).querySelector('[data-slot="rail-active-pill"]')!
    const sections = [railActivePillId(false, 'personal'), railActivePillId(false, 'project'), railActivePillId(true, 'personal'), railActivePillId(true, 'project')]
    expect(pill.getAttribute('data-pill-id')).toBeTruthy()
    expect(sections).not.toContain(pill.getAttribute('data-pill-id'))
  })
})

describe('RailChatList — a chat that joins the list', () => {
  test('fades in at the top while the chats that were there keep their faces', () => {
    const { rerender } = render(<RailChatList chats={chats()} />)
    const older = screen.getByRole('link', { name: 'Stellplatznachweis' }).closest('li')!
    rerender(
      <RailChatList
        chats={chats({ items: [{ id: 'c2', title: 'Abstandsflächen', href: '/app/projects/p1/chat?session=c2', current: true }, ...chats().items] })}
      />
    )
    const joined = screen.getByRole('link', { name: 'Abstandsflächen' }).closest('li')!
    expect(joined.style.opacity).toBe('0')
    expect(older.style.opacity).not.toBe('0')
    expect(screen.getByRole('link', { name: 'Stellplatznachweis' }).closest('li')).toBe(older)
  })
})
