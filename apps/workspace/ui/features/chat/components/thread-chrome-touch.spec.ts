import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { productionSources, nodesOf, parseSource, ts } from '@/test-utils/source-ast'
import { coarseFloorAxes } from '@/test-utils/touch-floor'
import { emptyRunLedger, setRunStatus } from '@/lib/runs/run-ledger'
import { useChatStore } from '@/features/chat/store'
import { AnswerActions } from './AnswerActions'
import { AnswerFeedback } from './AnswerFeedback'
import { RetryThoroughButton } from './RetryThoroughButton'
import { ChatArea } from '@/features/layout/components/ChatArea'
import { ChatToolbar } from '@/features/layout/components/ChatToolbar'
import { SessionItem } from '@/features/layout/components/sessions-panel/session-item'
import type { Session } from '@/features/layout/types'

const mockFeedback = vi.hoisted(() => ({ state: null as null | { verdict: 'up' | 'down' } }))

vi.mock('@/features/chat/hooks/use-answer-feedback', () => ({
  useAnswerFeedback: () => ({ state: mockFeedback.state, setFeedback: vi.fn() }),
}))

vi.mock('@/features/collaboration/hooks/use-sharing', () => ({
  useSharing: () => ({
    state: null,
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
  }),
  useShareCandidates: () => ({ candidates: [], loading: false, error: false, reload: vi.fn() }),
  useAwaitingState: vi.fn(() => ({ awaiting: null, refresh: vi.fn(), release: vi.fn() })),
  useMentionCandidates: vi.fn(() => ({ data: null, loading: false, restart: vi.fn() })),
}))

vi.mock('@/features/collaboration/hooks/use-shared-thread', () => ({
  useSharedThread: () => ({
    shared: false,
    myRole: null,
    loading: false,
    connected: false,
    turnInFlight: null,
    typists: [],
    participants: [],
    unreadAfterMessageId: null,
    lastArrival: null,
    authorOf: () => null,
    engagement: 'ask',
    engagementSuggestion: null,
    setEngagement: async () => true,
    refresh: () => {},
    clearTurnInFlight: vi.fn(),
    noteTurnActivity: vi.fn(),
  }),
}))

vi.mock('@/features/collaboration/hooks/use-spectated-turn', () => ({
  useSpectatedTurn: () => ({ turn: null, live: false }),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({ isAuthenticated: true, idToken: 'test-token', authRequired: true, user: { id: 'user-1', name: 'Max Mustermann' } }),
}))

vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/shared/hooks/use-connection-presence', () => ({ useConnectionPresence: () => 'connected' }))

const initialChatState = useChatStore.getState()
const question = { id: 'q1', role: 'user', content: 'Frage', messageType: 'user', timestamp: new Date('2026-10-09T08:00:00.000Z') }
const answer = { id: 'a1', role: 'assistant', content: 'Antwort', messageType: 'agent_response' }

function setConversation(messages: unknown[]): void {
  useChatStore.setState({
    currentConversation: { id: 'session-1', messages } as never,
    conversations: [],
    projectId: null,
    isStreaming: false,
    isLoading: false,
    hasHydrated: true,
    currentUserMessageId: null,
  } as never)
}

beforeEach(() => {
  mockFeedback.state = null
  useChatStore.setState(initialChatState, true)
  setConversation([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

const classesIn = (root: Element): string[] => [root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList])

function expectFortyFourOnTouch(root: Element): void {
  const controls = [...root.querySelectorAll('button, a[href], [role="button"], input, select, textarea')]
  expect(controls.length).toBeGreaterThan(0)
  for (const control of controls) {
    expect(coarseFloorAxes(control.classList), control.outerHTML).toEqual({ height: true, width: true })
  }
  expect(classesIn(root).filter((cls) => /\btouch-target\b/.test(cls))).toEqual([])
}

describe('thread chrome on a phone', () => {
  it('AnswerActions grows to 44px instead of borrowing a catchment', () => {
    const { container } = render(
      createElement(AnswerActions, { content: 'Antwort', body: 'Antwort', documents: [], messageId: 'a1' })
    )
    expectFortyFourOnTouch(container)
  })

  it('AnswerFeedback grows to 44px instead of borrowing a catchment', () => {
    const { container } = render(createElement(AnswerFeedback, { messageId: 'a1', conversationId: 'session-1' }))
    expectFortyFourOnTouch(container)
  })

  it('RetryThoroughButton grows to 44px instead of borrowing a catchment', () => {
    mockFeedback.state = { verdict: 'down' }
    setConversation([question, answer])
    useChatStore.setState({ chatSendFn: vi.fn() } as never)
    const { container } = render(createElement(RetryThoroughButton, { messageId: 'a1', conversationId: 'session-1' }))
    expect(container.querySelector('button')).not.toBeNull()
    expectFortyFourOnTouch(container)
  })

  it.each([
    'ui/features/chat/components/AnswerActions',
    'ui/features/chat/components/AnswerFeedback',
    'ui/features/chat/components/RetryThoroughButton',
    'ui/features/runs/components/RunBlock',
    'ui/features/runs/components/run-block/run-doc-chip',
    'ui/features/runs/components/run-block/run-elapsed',
    'ui/features/runs/components/run-block/run-phase-acts',
    'ui/features/runs/components/run-block/run-round-row',
    'ui/features/runs/components/run-block/run-separator',
    'ui/features/layout/components/SessionsPanel',
    'ui/features/layout/components/sessions-panel/deep-research-section',
    'ui/features/layout/components/sessions-panel/session-item',
    'ui/features/layout/components/sessions-panel/session-status-icon',
  ])('%s sets no text under 12px', (stem) => {
    const files = productionSources().filter((path) => path.startsWith(`${stem}.`))
    expect(files).toHaveLength(1)
    const tiny = nodesOf(parseSource(files[0]!), (node): node is ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    )
      .map((node) => node.text)
      .filter((text) => /text-\[(?:9|10|10\.5|11)px\]/.test(text))
    expect(tiny).toEqual([])
  })

  it('the history row has a visible menu on touch beside the hover overlay', async () => {
    const session: Session = { id: 's1', title: 'Gespräch', date: new Date('2026-10-09T08:00:00.000Z') }
    const user = userEvent.setup()
    const { container } = render(
      createElement('ul', null, createElement(SessionItem, { session, isSelected: false, onDelete: vi.fn(), onRename: vi.fn() }))
    )
    const menu = screen.getByTestId('session-row-menu')
    expect([...menu.classList]).toContain('pointer-coarse:inline-flex')

    await user.hover(container.querySelector('li') as HTMLElement)
    const overlay = [...container.querySelectorAll('div')].find((el) => el.classList.contains('pointer-coarse:hidden'))
    expect(overlay).toBeDefined()
    expect([...(overlay as HTMLElement).classList]).toEqual(expect.arrayContaining(['animate-in']))
  })

  it('the toolbar title is not capped to a share of the row, and its status is not desktop-only', () => {
    setConversation([
      { ...question, id: 'run-1', role: 'assistant', messageType: 'agent_response', content: '', runLedger: setRunStatus(emptyRunLedger('run-1'), 'running') },
    ])
    const { container } = render(createElement(ChatToolbar, { conversationId: 'session-1', isCollaborationEnabled: false }))
    expect(classesIn(container)).not.toContain('max-w-[64%]')
    const status = container.querySelector('[data-status-surface="phone"]') as HTMLElement
    expect(status).not.toBeNull()
    expect(status.querySelector('[data-testid="research-running"]')).not.toBeNull()
    expect([...status.classList]).toContain('flex')
  })

  it('the scroll-to-latest button is 44px on a finger', async () => {
    setConversation([question, answer])
    const { container } = render(createElement(ChatArea, { isAuthenticated: true, onSignIn: vi.fn() }))
    const region = screen.getByRole('region')
    const spacer = container.querySelector('[aria-hidden="true"][style*="min-height"]') as HTMLElement
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = this === spacer ? 1500 : 0
      const bottom = this === region ? 900 : 0
      return { top, bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }
    })

    fireEvent.wheel(region)
    region.scrollTop = 0
    fireEvent.scroll(region)

    const button = container.querySelector('[data-attr="chat-scroll-to-latest"]') as HTMLElement
    expect(button).not.toBeNull()
    expect([...button.classList]).toEqual(expect.arrayContaining(['size-9', 'pointer-coarse:size-11']))
  })
})
