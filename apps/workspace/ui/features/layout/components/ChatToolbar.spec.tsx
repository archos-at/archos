import { act, render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import type { JSX } from 'react'
import type { ResourceSharingState } from '@/lib/sharing/types'
import { ChatToolbar, RAIL_CHATS_BEFORE_PAGE } from './ChatToolbar'
import { useShellOverlays } from '@/components/shell/shell-overlays'
import type { ChatMessage } from '@/features/chat/types'
import { emptyRunLedger, setRunStatus } from '@/lib/runs/run-ledger'
import {
  markConversationMinted,
  markConversationOnServer,
  resetConversationsOnServer,
} from '@/features/chat/lib/conversation-on-server'

// Sharing data hooks are stubbed: this spec is about what the toolbar shows and
// gates, not about the (separately tested) fetching. The default state is "nothing
// loaded", which is exactly what a collaboration-disabled org looks like — so the
// pre-existing tests below are unaffected by the sharing surfaces.
let mockSharingState: ResourceSharingState | null = null
const mockUseSharing = vi.fn()

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useSharing: (...args: unknown[]) => {
    mockUseSharing(...args)
    return {
      state: mockSharingState,
      loading: false,
      loadError: false,
      failure: null,
      dismissFailure: vi.fn(),
      saving: false,
      refresh: vi.fn(),
      setVisibility: vi.fn(async () => true),
      grant: vi.fn(async () => true),
      changeRole: vi.fn(async () => true),
      revoke: vi.fn(async () => true),
      escalate: vi.fn(async () => true),
    }
  },
  useShareCandidates: () => ({ candidates: [], loading: false, error: false, reload: vi.fn() }),
}))

// Mock the layout store. The toolbar reads one thing off it — the sessions
// overlay. It held the mobile nav drawer too (the hamburger, now the phone tab
// bar's "Mehr") and the research panel until a run became a message in its own
// thread (ADR-0062).
const mockToggleSessionsPanel = vi.fn()

function getLayoutState() {
  return {
    toggleSessionsPanel: mockToggleSessionsPanel,
  }
}

vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector?: (s: ReturnType<typeof getLayoutState>) => unknown) => {
    const state = getLayoutState()
    return selector ? selector(state) : state
  }),
}))

// The phone shell's connection line asks `useIsMobile`; the context row itself is
// CSS (`md:hidden`), so jsdom renders it either way.
let mockIsMobile = false
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => mockIsMobile }))
vi.mock('@/shared/hooks/use-connection-presence', () => ({
  useConnectionPresence: () => 'connected',
}))

let mockIsAuthenticated = true

vi.mock('@/adapters/auth', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: mockIsAuthenticated })),
}))

let mockIsDeepResearchStreaming = false
let mockCurrentSessionId: string | null = 'session-1'
const mockUpdateConversationTitle = vi.fn()

vi.mock('@/features/chat/store', () => ({
  useChatStore: (
    selector: (state: {
      currentConversation: { id: string; messages: ChatMessage[] } | null
      updateConversationTitle: (id: string, title: string) => void
    }) => unknown
  ) =>
    selector({
      // A run going in the thread is a message whose stored ledger says so.
      currentConversation: mockCurrentSessionId
        ? {
            id: mockCurrentSessionId,
            messages: mockIsDeepResearchStreaming
              ? [
                  {
                    id: 'run-1',
                    role: 'assistant',
                    content: '',
                    messageType: 'agent_response',
                    timestamp: new Date('2026-01-01T00:00:00Z'),
                    runLedger: setRunStatus(emptyRunLedger('run-1'), 'running'),
                  },
                ]
              : [],
          }
        : null,
      updateConversationTitle: mockUpdateConversationTitle,
    }),
}))

/**
 * Open the thread menu — the one place every non-primary header action lives.
 * The header shows only what is TRUE about the thread plus New chat; share and
 * rename are behind this trigger by design, so most action tests start here.
 */
async function openThreadMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('thread-menu'))
  await screen.findByRole('menu')
}

/**
 * Pick an item out of the open thread menu.
 *
 * The hover is load-bearing, not decoration: a menu item is selected while it is
 * the *focused* item, and it becomes focused on pointer movement. `user.click`
 * dispatches no `pointermove`, so clicking an item that was never hovered fires
 * `onSelect` only sometimes — which showed up as a rename test that failed about
 * one run in four.
 */
async function selectMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
): Promise<void> {
  const item = screen.getByTestId(testId)
  await user.hover(item)
  await user.click(item)
}

describe('ChatToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated = true
    mockIsDeepResearchStreaming = false
    mockCurrentSessionId = 'session-1'
    mockSharingState = null
  })

  describe('research status', () => {
    test('a live run is STATUS in the header, and the header offers nothing else', async () => {
      mockIsDeepResearchStreaming = true
      mockSharingState = SHARED_STATE
      const user = userEvent.setup()

      render(<ChatToolbar conversationId="session-1" isCollaborationEnabled />)

      // The one piece of research the header carries in the open: the thread's own
      // banner scrolls away, so this is the persistent "still working" signal. It
      // states, and there is nothing left for it to act WITH — a run is read in
      // the thread that commissioned it (ADR-0062), so the menu holds no way out
      // to a side panel.
      const running = screen.getAllByTestId('research-running')[0]!
      expect(running).toBeInTheDocument()
      expect(running.querySelector('button')).toBeNull()

      await openThreadMenu(user)
      expect(screen.queryByTestId('research-panel-toggle')).not.toBeInTheDocument()
    })

    test('says nothing about research when nothing is running', () => {
      mockIsDeepResearchStreaming = false
      mockSharingState = SHARED_STATE

      render(<ChatToolbar conversationId="session-1" isCollaborationEnabled />)

      expect(screen.queryByTestId('research-running')).not.toBeInTheDocument()
    })

    test('a run alone puts no menu on the thread', () => {
      mockIsDeepResearchStreaming = true
      mockCurrentSessionId = null // …and nothing else to put in the menu either

      render(<ChatToolbar />)

      // With no rename and no sharing there is nothing occasional to disclose on
      // a desktop, so the trigger is gone there. It stays for a phone, where it
      // holds New chat, because the phone's right pill is that one square.
      expect(screen.getByTestId('thread-menu')).toHaveClass('sm:hidden')
    })

    test('a thread with something to disclose keeps the menu on every width', () => {
      render(<ChatToolbar sessionTitle="My Session" />)

      expect(screen.getByTestId('thread-menu')).not.toHaveClass('sm:hidden')
    })
  })

  describe('thread row on a phone', () => {
    test('New chat is the first entry of the ⋯ menu there, and still a button in the open on a desktop', async () => {
      const user = userEvent.setup()
      const onNewSession = vi.fn()
      render(<ChatToolbar sessionTitle="My Session" onNewSession={onNewSession} />)

      expect(screen.getByRole('button', { name: 'Create new session' })).toHaveClass('max-sm:hidden')
      await openThreadMenu(user)
      const item = screen.getByTestId('new-chat-menu-item')
      expect(item).toHaveClass('sm:hidden')
      await user.hover(item)
      await user.click(item)

      expect(onNewSession).toHaveBeenCalledTimes(1)
    })

    test('beside a title the door’s word stands under its glyph, so the title keeps its room', () => {
      render(<ChatToolbar sessionTitle="Brandschutz Stiegenhaus" />)

      expect(screen.getByTestId('chat-history-door')).toHaveClass('max-sm:flex-col', 'max-sm:text-meta')
    })
  })

  describe('thread row on a phone — a run and a rule together', () => {
    test('the title hyphenates at syllables, and the chip steps aside for the spinner', () => {
      mockIsDeepResearchStreaming = true
      mockSharingState = { ...SHARED_STATE, visibility: 'project' }

      render(
        <ChatToolbar sessionTitle="Brandschutzkonzept" conversationId="session-1" isCollaborationEnabled />
      )

      expect(screen.getByText('Brandschutzkonzept')).toHaveClass('hyphens-auto', 'break-words')
      const phone = document.querySelector('[data-status-surface="phone"]')
      expect(phone?.querySelector('[data-testid="research-running"]')).not.toBeNull()
      expect(phone?.querySelector('[data-testid="access-chip"]')).toBeNull()
      // The desktop pill still states the rule.
      expect(document.querySelector('[data-status-surface="desktop"] [data-testid="access-chip"]')).not.toBeNull()
    })
  })

  describe('phone top', () => {
    beforeEach(() => {
      useShellOverlays.setState({ paletteOpen: false })
      mockIsMobile = false
    })

    // The founder (2026-11-10): „on mobile lets remove it entirely“. No project name and no lone search
    // glyph stand over the pills: the project is the first row of „Mehr“, and the search is listed there.
    test('carries no project name and no search over the pills: the toolbar starts with its pills', () => {
      mockIsMobile = true
      render(<ChatToolbar sessionTitle="My Session" />)

      const line = screen.getByTestId('chat-connection-line')
      expect(line.querySelectorAll('button, a, p')).toHaveLength(0)
      expect(screen.queryByTestId('shell-search')).toBeNull()
      expect(screen.queryByTestId('project-crumb')).toBeNull()
    })

    test('the connection line is mounted on the phone shell only', () => {
      const { unmount } = render(<ChatToolbar />)
      expect(document.querySelector('[data-slot="connection-band"]')).toBeNull()
      unmount()

      mockIsMobile = true
      render(<ChatToolbar />)
      expect(document.querySelector('[data-slot="connection-band"]')).not.toBeNull()
    })

    test('reports its height so the transcript can start below it', () => {
      const onHeightChange = vi.fn()
      const rect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ height: 163 } as DOMRect)
      render(<ChatToolbar onHeightChange={onHeightChange} />)
      rect.mockRestore()

      expect(onHeightChange).toHaveBeenCalledWith(163)
    })
  })

  describe('chat-started gating', () => {
    test('hides New chat, the thread menu and the breadcrumb before a chat has started', () => {
      render(
        <ChatToolbar
          sessionTitle="My Session"
          isChatStarted={false}
        />
      )

      // The quiet navigation affordances stay available on the empty start screen.
      expect(screen.getByRole('button', { name: 'Chats' })).toBeInTheDocument()

      // The actions + thread identity are withheld until a chat starts.
      expect(screen.queryByTestId('thread-menu')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Create new session' })
      ).not.toBeInTheDocument()
      expect(screen.queryByText('My Session')).not.toBeInTheDocument()
    })

    test('shows New chat, the thread menu and the breadcrumb once a chat has started', async () => {
      const user = userEvent.setup()
      render(
        <ChatToolbar
          sessionTitle="My Session"
          isChatStarted
        />
      )

      expect(screen.getByRole('button', { name: 'Create new session' })).toBeInTheDocument()
      expect(screen.getByText('My Session')).toBeInTheDocument()

      await openThreadMenu(user)
      expect(screen.getByTestId('rename-session')).toBeInTheDocument()
    })
  })

  describe('new session button', () => {
    test('invokes onNewSession when enabled', async () => {
      const onNewSession = vi.fn()
      const user = userEvent.setup()

      render(<ChatToolbar onNewSession={onNewSession} />)

      await user.click(screen.getByRole('button', { name: 'Create new session' }))

      expect(onNewSession).toHaveBeenCalledOnce()
    })

    test('is disabled while a session is active', () => {
      render(<ChatToolbar isNewSessionDisabled />)

      expect(screen.getByRole('button', { name: 'Create new session' })).toBeDisabled()
    })
  })

  // The data-sources toggle was removed from the toolbar: the composer's
  // Datengrundlage chip already owns opening that panel, so the navbar no
  // longer duplicates it.
  // None of the pilot offices found the chat history (2026-11-10): its door was a lone glyph whose name lived
  // in aria-label and title alone. Its word is visible at every width, in every state of the chat.
  describe('the history door is never a glyph alone', () => {
    const HIDING = /(^|:)(hidden|sr-only|invisible)$/
    // The one place it stands down: beside a rail that lists the chats (below).
    const BESIDE_RAIL = `md:[${RAIL_CHATS_BEFORE_PAGE}_&]:hidden`

    test.each([
      ['an empty chat', { isChatStarted: false }],
      ['a chat with a title', { isChatStarted: true, sessionTitle: 'Fluchtweglängen OG2' }],
      ['a chat whose title is not in yet', { isChatStarted: true }],
    ])('%s: the door says „Chats“ in words, and no breakpoint alone hides them', (_, props) => {
      render(<ChatToolbar {...props} />)

      const door = screen.getByTestId('chat-history-door')
      const label = door.querySelector('[data-slot="history-door-label"]')
      expect(label?.textContent).toBe('Chats')
      // Its accessible name is the word it shows (label in name), not an aria-label beside a glyph.
      expect(door).not.toHaveAttribute('aria-label')
      expect(door).toHaveAccessibleName('Chats')
      for (const node of [door, label]) {
        expect([...(node?.classList ?? [])].filter((c) => HIDING.test(c) && c !== BESIDE_RAIL), node?.outerHTML.slice(0, 80)).toEqual([])
      }
    })

    // Owner decision 2026-11-12: the history moved into the rail („Alle Chats“), so the door beside it was the
    // same door twice. The rail has its own provider, so the page asks the document: the door stands down only
    // behind a rail (`sidebar-wrapper`) that draws its chat list (`rail-chats`), which it does while it is wide
    // and the project has chats. A phone, the icon rail and a project without chats keep the door.
    const shell = (rail: JSX.Element): JSX.Element => (
      <div>
        <div data-slot="sidebar-wrapper">{rail}</div>
        <main>
          <ChatToolbar isChatStarted sessionTitle="Fluchtweglängen OG2" />
        </main>
      </div>
    )
    const behindRailChats = (): Element | null => document.querySelector(`${RAIL_CHATS_BEFORE_PAGE} [data-testid="chat-history-door"]`)

    test('beside a rail that lists the chats, the door and the rule after it stand down from `md`', () => {
      render(shell(<ul data-testid="rail-chats" />))
      const door = screen.getByTestId('chat-history-door')
      expect(behindRailChats()).toBe(door)
      expect(door).toHaveClass(BESIDE_RAIL)
      // The rule that parted the door from the title goes with it, or the title would start with a stray line.
      expect(door.nextElementSibling).toHaveClass('w-px', BESIDE_RAIL)
    })

    test('beside a rail that lists none (the icon rail, a project without chats), the door stays', () => {
      render(shell(<nav />))
      expect(screen.getByTestId('chat-history-door')).toBeInTheDocument()
      expect(behindRailChats()).toBeNull()
    })
  })

  describe('sessions toggle', () => {
    test('toggles the sessions panel', async () => {
      const user = userEvent.setup()

      render(<ChatToolbar />)

      await user.click(screen.getByRole('button', { name: 'Chats' }))

      expect(mockToggleSessionsPanel).toHaveBeenCalledOnce()
    })
  })

  describe('phone layout', () => {
    // The thread's name is what the row is for. At 393px it was cut to eight
    // characters, because a hamburger (now the tab bar's "Mehr"), the history
    // door, the title and two actions shared 361px under a 64% cap.
    test('has no hamburger: the phone tab bar owns the drawer', () => {
      render(<ChatToolbar sessionTitle="Fluchtwegbreiten Treppenhaus 2" />)

      expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Chats' })).toBeInTheDocument()
    })

    test('the title takes the leftover width and may use two lines', () => {
      render(<ChatToolbar sessionTitle="Fluchtwegbreiten Treppenhaus 2" />)

      const title = screen.getByText('Fluchtwegbreiten Treppenhaus 2')
      expect(title.className).toContain('line-clamp-2')
      // No percentage cap on the pill that holds it.
      expect(title.closest('div[class*="max-sm:flex-1"]')).not.toBeNull()
      expect(title.closest('div[class*="max-w-[64%]"]')).toBeNull()
    })

    // Ticket #38, R1: in a narrow window the title ran under „Neuer Chat“, both
    // unreadable, and the thread read through the header behind the pills.
    test('from `sm` the title yields to New chat: it shrinks and clamps, the actions keep their width', () => {
      render(<ChatToolbar sessionTitle="Wiener Garagengesetz — Stellplatzverpflichtung" />)

      const title = screen.getByText('Wiener Garagengesetz — Stellplatzverpflichtung')
      expect(title.className).toContain('sm:line-clamp-1')
      // `flex-none` cannot shrink: the title kept its whole width and overflowed.
      for (const box of [title.closest('button'), title.closest('nav')]) {
        expect(box?.className).toContain('min-w-0')
        expect(box?.className).toContain('sm:flex-initial')
        expect(box?.className).not.toContain('sm:flex-none')
      }
      const newChat = screen.getByRole('button', { name: 'Create new session' })
      expect(newChat.parentElement?.className).toContain('shrink-0')
    })

    test('the header is an opaque band in the page surface, and takes its own clicks', () => {
      render(<ChatToolbar sessionTitle="My Session" />)

      const header = screen.getByRole('banner')
      expect(header.className).toContain('bg-background')
      expect(header.className).not.toContain('pointer-events-none')
    })

    test('a running research is on the phone too, at the end of the title row, not behind `hidden sm:flex`', () => {
      mockIsDeepResearchStreaming = true

      render(<ChatToolbar sessionTitle="Brandschutz" />)

      const phone = document.querySelector('[data-status-surface="phone"]')
      expect(phone).not.toBeNull()
      expect(phone).toHaveTextContent('Researching')
      // Shown below `sm`, gone at `sm` where the right pill carries it.
      expect(phone?.className).toContain('sm:hidden')
      expect(phone?.className).not.toContain('hidden sm:')
    })

    test('a running research with no title yet still has its status line', () => {
      mockIsDeepResearchStreaming = true

      render(<ChatToolbar sessionTitle="" />)

      expect(document.querySelector('[data-status-surface="phone"]')).not.toBeNull()
    })

    test('who can read the thread is on the phone too', () => {
      mockSharingState = { ...SHARED_STATE, visibility: 'project' }

      render(
        <ChatToolbar
          sessionTitle="My Session"
          isCollaborationEnabled
          conversationId="session-1"
          currentUserId="u-me"
        />,
      )

      const phone = document.querySelector('[data-status-surface="phone"]')
      expect(phone?.querySelector('[data-testid="access-chip"]')).not.toBeNull()
    })

    test('New chat is a 44px square on a phone, like the menu beside it', () => {
      render(<ChatToolbar sessionTitle="My Session" />)

      expect(screen.getByRole('button', { name: 'Create new session' }).className).toContain(
        'size-11',
      )
    })
  })

  describe('breadcrumb + inline rename', () => {
    test('renders the current session title', () => {
      render(<ChatToolbar sessionTitle="My Session" />)

      expect(screen.getByText('My Session')).toBeInTheDocument()
    })

    test('the title is the size of the New chat label beside it, from `sm` on', () => {
      // The title read as a heading next to a button, one step larger than the
      // only other words in the row. Beside each other they are one row.
      render(<ChatToolbar sessionTitle="My Session" />)

      const newChatLabel = screen.getByText('New chat')
      const title = screen.getByRole('button', { name: /rename session/i })
      expect(newChatLabel.className).toContain('text-xs')
      expect(title.className).toContain('sm:text-xs')
      expect(title.className).toContain('sm:leading-4')
    })

    test('does not repeat the project name in the breadcrumb — the context row above it carries it', () => {
      render(<ChatToolbar sessionTitle="My Session" />)

      const breadcrumb = screen.getByRole('navigation')
      expect(within(breadcrumb).queryByText('Wohnbau Favoriten')).not.toBeInTheDocument()
      expect(within(breadcrumb).getByText('My Session')).toBeInTheDocument()
    })

    test('clicking the title opens the editor — the shortcut, alongside the menu', async () => {
      const user = userEvent.setup()
      render(<ChatToolbar sessionTitle="My Session" />)

      // Two ways in, on purpose: the menu entry is how anyone DISCOVERS renaming,
      // this is the fast path once you know it. Unlike the menu route it needs no
      // deferral — no menu is closing, so nothing is about to reclaim focus.
      await user.click(screen.getByRole('button', { name: /rename session/i }))

      expect(screen.getByRole('textbox', { name: /session title/i })).toHaveValue('My Session')
    })

    test('the title cannot be renamed without an active session', () => {
      mockCurrentSessionId = null
      render(<ChatToolbar sessionTitle="My Session" />)

      expect(screen.getByRole('button', { name: /rename session/i })).toBeDisabled()
    })

    test('the menu opens the inline editor; Enter commits via the store rename action', async () => {
      const user = userEvent.setup()
      render(<ChatToolbar sessionTitle="My Session" />)

      await openThreadMenu(user)
      await selectMenuItem(user, 'rename-session')

      const input = await screen.findByRole('textbox', { name: /session title/i }, { timeout: 5000 })
      expect(input).toHaveValue('My Session')

      await user.clear(input)
      await user.type(input, 'Fluchtweg OG2{Enter}')

      expect(mockUpdateConversationTitle).toHaveBeenCalledWith('session-1', 'Fluchtweg OG2')
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    test('Escape cancels the edit without renaming', async () => {
      const user = userEvent.setup()
      render(<ChatToolbar sessionTitle="My Session" />)

      await openThreadMenu(user)
      await selectMenuItem(user, 'rename-session')
      const input = await screen.findByRole('textbox', { name: /session title/i }, { timeout: 5000 })
      await user.clear(input)
      await user.type(input, 'discarded{Escape}')

      expect(mockUpdateConversationTitle).not.toHaveBeenCalled()
      expect(screen.getByText('My Session')).toBeInTheDocument()
    })

    test('blur commits the edit', async () => {
      const user = userEvent.setup()
      render(<ChatToolbar sessionTitle="My Session" />)

      await openThreadMenu(user)
      await selectMenuItem(user, 'rename-session')
      const input = await screen.findByRole('textbox', { name: /session title/i }, { timeout: 5000 })
      await user.clear(input)
      await user.type(input, 'Renamed on blur')
      await user.tab()

      expect(mockUpdateConversationTitle).toHaveBeenCalledWith('session-1', 'Renamed on blur')
    })

    test('committing an unchanged or empty title does not rename', async () => {
      const user = userEvent.setup()
      render(<ChatToolbar sessionTitle="My Session" />)

      await openThreadMenu(user)
      await selectMenuItem(user, 'rename-session')
      await screen.findByRole('textbox', { name: /session title/i }, { timeout: 5000 })
      await user.keyboard('{Enter}')

      expect(mockUpdateConversationTitle).not.toHaveBeenCalled()
    })

    test('rename is not offered without an active session', async () => {
      mockCurrentSessionId = null
      mockSharingState = SHARED_STATE // keep the menu itself around
      const user = userEvent.setup()
      render(<ChatToolbar sessionTitle="My Session" conversationId="session-1" isCollaborationEnabled />)

      await openThreadMenu(user)

      // An action that cannot run is not listed. A disabled row here would only
      // pose a question the reader cannot answer from the menu.
      expect(screen.queryByTestId('rename-session')).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Sharing surfaces (spec SH-17/SH-18). Everything here is gated twice: the org's
// collaboration flag AND a reachable, started conversation.
// ---------------------------------------------------------------------------

const SHARED_STATE: ResourceSharingState = {
  resourceType: 'conversation',
  resourceId: 'session-1',
  visibility: 'private',
  allowedVisibilities: ['private', 'project'],
  myRole: 'owner',
  canManage: true,
  canEscalate: false,
  shared: true,
  entries: [
    {
      person: { userId: 'u-me', name: 'Matthias Bigl', email: null, profilePictureUrl: null },
      role: 'owner',
      reason: 'creator',
      grantedBy: null,
    },
    {
      person: { userId: 'u-anna', name: 'Anna Weber', email: null, profilePictureUrl: null },
      role: 'collaborator',
      reason: 'grant',
      grantedBy: 'u-me',
    },
  ],
}

describe('ChatToolbar — sharing surfaces', () => {
  // This block used to inherit whatever the previous test happened to leave in the
  // module-level mocks — the reset lives in the other describe's beforeEach, which
  // does not reach here. Reset explicitly so each case states its own preconditions.
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAuthenticated = true
    mockIsDeepResearchStreaming = false
    mockCurrentSessionId = 'session-1'
    mockSharingState = null
  })

  test('shows nothing collaboration-related when the feature is off (default-deny)', () => {
    render(<ChatToolbar sessionTitle="My Session" conversationId="session-1" />)

    expect(mockUseSharing).toHaveBeenCalledWith('conversation', 'session-1', false)
    expect(screen.queryByTestId('participant-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('access-chip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument()
  })

  test('does not even ask the server without a conversation, or before the chat starts', () => {
    render(<ChatToolbar isCollaborationEnabled conversationId={null} />)
    expect(mockUseSharing).toHaveBeenLastCalledWith('conversation', null, false)

    render(<ChatToolbar isCollaborationEnabled conversationId="session-1" isChatStarted={false} />)
    expect(mockUseSharing).toHaveBeenLastCalledWith('conversation', 'session-1', false)
  })

  test('asks for sharing state once the feature is on and the thread is reachable', () => {
    mockSharingState = SHARED_STATE
    render(<ChatToolbar sessionTitle="My Session" isCollaborationEnabled conversationId="session-1" />)

    expect(mockUseSharing).toHaveBeenCalledWith('conversation', 'session-1', true)
  })

  test('a chat minted here is not asked about until the server has created it', () => {
    // The header appears with the first message, and the server row with that
    // message's store: asking in between was a 404 on every new chat.
    resetConversationsOnServer()
    markConversationMinted('session-new')
    const { rerender } = render(
      <ChatToolbar sessionTitle="Neu" isCollaborationEnabled conversationId="session-new" />
    )
    expect(mockUseSharing).toHaveBeenLastCalledWith('conversation', 'session-new', false)

    act(() => markConversationOnServer('session-new'))
    rerender(<ChatToolbar sessionTitle="Neu" isCollaborationEnabled conversationId="session-new" />)
    expect(mockUseSharing).toHaveBeenLastCalledWith('conversation', 'session-new', true)
  })

  test('states who-can-see-this ONCE — the faces, not the faces plus a chip saying the same', () => {
    mockSharingState = SHARED_STATE
    render(
      <ChatToolbar
        sessionTitle="My Session"
        isCollaborationEnabled
        conversationId="session-1"
        currentUserId="u-me"
      />,
    )

    expect(screen.getAllByTestId('participant-strip').length).toBeGreaterThan(0)
    // The chip would read "Shared with 1" — the same sentence the two faces
    // already are, and the widest element in a row that has to hold the thread's
    // own title. Under `private` the roster IS the audience, so the faces say it.
    expect(screen.queryByTestId('access-chip')).not.toBeInTheDocument()
  })

  test('the faces are STATUS — they say who is here, they do not act', () => {
    mockSharingState = SHARED_STATE
    render(
      <ChatToolbar
        sessionTitle="My Session"
        isCollaborationEnabled
        conversationId="session-1"
        currentUserId="u-me"
      />,
    )

    // The header's rule: information is not clickable, controls look like
    // controls. An avatar stack that silently opened a dialog was the clearest
    // case of the two being mixed — and it made sharing's ONE door into three.
    for (const strip of screen.getAllByTestId('participant-strip')) {
      expect(strip.tagName).not.toBe('BUTTON')
    }
  })

  test('a blanket rule REPLACES the faces — the rule is the audience, not the roster', () => {
    mockSharingState = { ...SHARED_STATE, visibility: 'project' }
    render(
      <ChatToolbar
        sessionTitle="My Session"
        isCollaborationEnabled
        conversationId="session-1"
        currentUserId="u-me"
      />,
    )

    expect(screen.getAllByTestId('access-chip')[0]).toHaveTextContent('Project')
    // Not both. Under a blanket rule the roster is not a summary of the audience
    // but a partial sample of it — two faces beside "Projekt" read as "these two
    // can see it" when the truth is "everyone in the project can". The named
    // exceptions belong where there is room to explain them: the sharing surface.
    expect(screen.queryByTestId('participant-strip')).not.toBeInTheDocument()
  })

  test('a solo private thread carries no collaboration furniture at all', async () => {
    mockSharingState = { ...SHARED_STATE, entries: [SHARED_STATE.entries[0]] }
    const user = userEvent.setup()
    render(
      <ChatToolbar
        sessionTitle="My Session"
        isCollaborationEnabled
        conversationId="session-1"
        currentUserId="u-me"
      />,
    )

    // Neither faces nor a "Private" chip: the default state of the overwhelmingly
    // common thread needs no announcement…
    expect(screen.queryByTestId('participant-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('access-chip')).not.toBeInTheDocument()
    // …but sharing is still reachable, which is how a thread stops being solo.
    await openThreadMenu(user)
    expect(screen.getByTestId('share-button')).toBeInTheDocument()
  })

  test('sharing has exactly ONE door in the header (SH-17), and it is the menu', async () => {
    mockSharingState = SHARED_STATE
    const user = userEvent.setup()
    render(
      <ChatToolbar
        sessionTitle="My Session"
        isCollaborationEnabled
        conversationId="session-1"
        currentUserId="u-me"
      />,
    )

    // Nothing in the open row opens it — not the faces, not a second button.
    expect(screen.queryByTestId('share-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument()

    await openThreadMenu(user)
    await selectMenuItem(user, 'share-button')

    expect(await screen.findByTestId('share-dialog')).toBeInTheDocument()
  })

  test('nothing is claimed about access before the server has answered', async () => {
    mockSharingState = null
    const user = userEvent.setup()
    render(<ChatToolbar sessionTitle="My Session" isCollaborationEnabled conversationId="session-1" />)

    expect(screen.queryByTestId('access-chip')).not.toBeInTheDocument()
    await openThreadMenu(user)
    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument()
  })
})
