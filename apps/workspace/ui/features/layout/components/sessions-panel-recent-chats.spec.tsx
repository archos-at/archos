import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { SessionsPanel } from './SessionsPanel'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { LayoutStore } from '../types'
import { setupChatStoreMock } from './sessions-panel.fixtures'
import { RailChatsSource, type RailChats } from '@/components/shell/rail-chats'
import { useIsMobile } from '@/hooks/use-is-mobile'

const setSessionsPanelOpen = vi.fn()
vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector?: StoreSelector<LayoutStore>) => {
    const state: DeepPartial<LayoutStore> = { isSessionsPanelOpen: true, setSessionsPanelOpen }
    return selector ? selector(asStoreState<LayoutStore>(state)) : state
  }),
}))
vi.mock('@/features/chat/store', () => ({ useChatStore: vi.fn() }))
vi.mock('@/hooks/use-is-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-is-mobile')>()),
  useIsMobile: vi.fn(() => true),
}))

const today = new Date()
const sessions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, title: `Chat ${id.toUpperCase()}`, date: today }))
const onOpen = vi.fn()
const rail: RailChats = {
  items: [
    ...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, title: `Chat ${id.toUpperCase()}`, href: `/app/personal/chat?session=${id}`, current: id === 'a' })),
  ],
  allHref: '/app/personal/chat',
  onOpen,
}
const withRail = (node: ReactNode) => <RailChatsSource value={rail}>{node}</RailChatsSource>

beforeEach(() => {
  vi.clearAllMocks()
  setupChatStoreMock()
  vi.mocked(useIsMobile).mockReturnValue(true)
})

describe('„Letzte Chats“ on top of the phone’s chat list', () => {
  test('lists the side’s last five chats first, then the rest without them', () => {
    render(withRail(<SessionsPanel sessions={sessions} />))
    const recent = screen.getByTestId('sessions-recent-chats')
    expect(within(recent).getAllByRole('link').map((link) => link.textContent)).toEqual(['Chat A', 'Chat B', 'Chat C', 'Chat D', 'Chat E'])
    expect(within(recent).getByRole('link', { name: 'Chat A' })).toHaveAttribute('aria-current', 'page')
    expect(within(recent).getByRole('link', { name: 'Chat B' })).toHaveAttribute('href', '/app/personal/chat?session=b')
    const rest = screen.getAllByRole('listitem').filter((item) => !recent.contains(item)).map((item) => item.textContent ?? '')
    expect(rest.some((text) => text.includes('Chat F'))).toBe(true)
    expect(rest.some((text) => text.includes('Chat A'))).toBe(false)
    expect(recent.compareDocumentPosition(screen.getAllByRole('listitem').find((item) => !recent.contains(item))!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  test('a tap opens the chat and closes the list', async () => {
    render(withRail(<SessionsPanel sessions={sessions} />))
    await userEvent.click(within(screen.getByTestId('sessions-recent-chats')).getByRole('link', { name: 'Chat C' }))
    expect(onOpen).toHaveBeenCalledWith('c')
    expect(setSessionsPanelOpen).toHaveBeenCalledWith(false)
  })

  test('stands down while searching, and on a desktop, where the rail lists them', async () => {
    const { unmount } = render(withRail(<SessionsPanel sessions={sessions} />))
    await userEvent.type(screen.getByRole('textbox'), 'Chat')
    expect(screen.queryByTestId('sessions-recent-chats')).toBeNull()
    unmount()

    vi.mocked(useIsMobile).mockReturnValue(false)
    render(withRail(<SessionsPanel sessions={sessions} />))
    expect(screen.queryByTestId('sessions-recent-chats')).toBeNull()
  })
})
