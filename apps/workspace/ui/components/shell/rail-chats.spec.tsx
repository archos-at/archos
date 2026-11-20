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
})
