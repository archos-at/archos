import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnswerCard } from '@/shared/cards/schemas'
import { cardKeyOfDecisionKey, INTERACTIVE_CARD_TYPES, LIVE_CARD_TYPES } from './card-decision'
import { AnswerCardItem, AnswerCards, AnswerCardView } from './components/AnswerCards'
import { CARD_PREVIEW_FIXTURES } from './preview-fixtures'

const setCardDecision = vi.fn()

const mockStoreState = () => ({
  projectId: 'proj-1',
  currentConversation: { id: 'conv-1', messages: [{ id: 'msg-1', cardInteractions: undefined }] },
  conversations: [],
  setCardDecision,
})

vi.mock('@/features/chat/store', () => {
  const useChatStore = (selector: (s: unknown) => unknown) => selector(mockStoreState())
  useChatStore.getState = () => mockStoreState()
  return { useChatStore }
})

const SETTLE_CASES: Partial<
  Record<AnswerCard['type'], { card: AnswerCard; action: string; response?: unknown }>
> = {
  project_profile_patch: {
    card: {
      type: 'project_profile_patch',
      title: 'Update brief',
      rationale: 'Learned the class.',
      patch: [{ op: 'add', path: '/facts/gebaeudeklasse', value: 'GK4' }],
    } as AnswerCard,
    action: 'Reject',
  },
  memory_proposal: {
    card: {
      type: 'memory_proposal',
      title: 'Save this finding?',
      content: 'The firm always uses REI 90 for GK4.',
      kind: 'preference',
      confidence: 'high',
    } as AnswerCard,
    action: 'No',
  },
  document_draft: {
    card: {
      type: 'document_draft',
      title: 'Aktenvermerk – Fluchtweg',
      path: '/entwuerfe/aktenvermerk.md',
      bytes: 4820,
      version: 2,
      document_id: 'doc-1',
      version_id: 'ver-1',
      version_state: 'published',
      filed_draft_version: 1,
    } as AnswerCard,
    action: 'Update in the project',
    response: {
      documentId: 'doc-1',
      versionId: 'ver-2',
      state: 'published',
      alreadyFiled: true,
      outcome: 'updated',
      draftVersion: 2,
    },
  },
}

const DECIDED_ON_THE_SERVER: ReadonlySet<AnswerCard['type']> = new Set(['file_operation_proposal', 'operation_proposal'])

describe('interactive card wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has a settle case for every card classified as interactive', () => {
    const uncovered = INTERACTIVE_CARD_TYPES.filter((type) => !SETTLE_CASES[type] && !DECIDED_ON_THE_SERVER.has(type))
    expect(
      uncovered,
      `Card type(s) ${uncovered.join(', ')} are classified 'interactive' in CARD_INTERACTIVITY but ` +
        'have no settle case here. Add one — and make sure the card takes messageId + cardKey and ' +
        'uses useCardDecision, or its answer will not survive a reload.',
    ).toEqual([])
  })

  for (const [type, testCase] of Object.entries(SETTLE_CASES)) {
    const stubFetch = () =>
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => testCase.response ?? {} })),
      )

    it(`records the decision on the owning message for ${type}`, async () => {
      stubFetch()
      const user = userEvent.setup()
      render(<AnswerCards cards={[testCase.card]} projectId="proj-1" messageId="msg-1" />)

      await user.click(await screen.findByRole('button', { name: testCase.action }))

      await waitFor(() => expect(setCardDecision).toHaveBeenCalled())
      const [messageId, cardKey] = setCardDecision.mock.calls[0]
      expect(messageId).toBe('msg-1')
      expect(cardKeyOfDecisionKey(cardKey)).toBe(`${type}-0`)
    })

    it(`keys ${type} on its original index when drawn inline`, async () => {
      stubFetch()
      const user = userEvent.setup()
      render(
        <AnswerCardItem card={testCase.card} index={2} projectId="proj-1" messageId="msg-1" />,
      )

      await user.click(await screen.findByRole('button', { name: testCase.action }))

      await waitFor(() => expect(setCardDecision).toHaveBeenCalled())
      expect(cardKeyOfDecisionKey(setCardDecision.mock.calls[0][1])).toBe(`${type}-2`)
    })

    it(`offers no way to settle ${type} when the decision could not be kept`, async () => {
      render(<AnswerCards cards={[testCase.card]} projectId="proj-1" decisionsMustPersist />)
      await waitFor(() => expect(document.querySelector('[data-slot="card-placeholder"]')).toBeNull())

      expect(screen.queryByRole('button', { name: testCase.action })).toBeNull()
      expect(setCardDecision).not.toHaveBeenCalled()
    })

    it(`keys ${type} on its original index in the fallback block`, async () => {
      stubFetch()
      const user = userEvent.setup()
      const filler = CARD_PREVIEW_FIXTURES.calculation!
      render(
        <AnswerCards
          cards={[filler, testCase.card]}
          indices={[1]}
          projectId="proj-1"
          messageId="msg-1"
        />,
      )

      expect(screen.queryByText('Platzhalter')).toBeNull()
      await user.click(await screen.findByRole('button', { name: testCase.action }))

      await waitFor(() => expect(setCardDecision).toHaveBeenCalled())
      expect(cardKeyOfDecisionKey(setCardDecision.mock.calls[0][1])).toBe(`${type}-1`)
    })
  }

  it('keys a leaf of a surface on its id as well as the surface index', async () => {
    const { card, action } = SETTLE_CASES.memory_proposal!
    const user = userEvent.setup()
    render(<AnswerCardView card={card} index={2} leafId="b" projectId="proj-1" messageId="msg-1" />)

    await user.click(await screen.findByRole('button', { name: action }))

    await waitFor(() => expect(setCardDecision).toHaveBeenCalled())
    expect(setCardDecision.mock.calls[0][1]).toBe('memory_proposal-2.b')
  })
})

type User = ReturnType<typeof userEvent.setup>

interface LiveScenario {
  name: string
  press: (user: User) => Promise<void>
}

const annotationView = (id: string, number: number, status: string) => ({
  id,
  documentId: 'doc-1',
  number,
  page: 1,
  shape: 'point',
  x: 0.4,
  y: 0.3,
  w: null,
  h: null,
  kind: 'defect',
  body: 'Laufbreite im Treppenhaus unter 1,20 m.',
  basis: null,
  authorKind: id === 'ann-9' ? 'person' : 'piloti',
  status,
  assigneeUserId: null,
  assigneeName: null,
  dueOn: null,
  revisionNumber: 1,
  onCurrentRevision: true,
  createdBy: 'user_1',
  createdByName: 'Anna',
  createdAt: '2026-10-13T08:00:00.000Z',
  updatedAt: '2026-10-13T08:01:00.000Z',
  acceptedBy: null,
  acceptedByName: null,
  closedBy: null,
  closedByName: null,
  closedAt: null,
  replies: [],
  canEdit: true,
  canDelete: false,
})

const proposedMark = (id: string, number: number) => ({
  action: 'proposed',
  annotation_id: id,
  number,
  page: 1,
  shape: 'point',
  x: 0.4,
  y: 0.3,
  kind: 'defect',
  body: 'Laufbreite im Treppenhaus unter 1,20 m.',
})

const LIVE_CASES: Partial<
  Record<AnswerCard['type'], { card: AnswerCard; routes: (url: string, init?: RequestInit) => unknown; scenarios: LiveScenario[] }>
> = {
  canvas_activity: {
    card: {
      type: 'canvas_activity',
      document: { id: 'doc-1', name: 'Grundriss EG.pdf' },
      items: [
        proposedMark('ann-4', 4),
        proposedMark('ann-5', 5),
        proposedMark('ann-6', 6),
        {
          action: 'changed',
          annotation_id: 'ann-9',
          number: 9,
          status: 'resolved',
          changes: [{ field: 'status', before: 'open', after: 'resolved' }],
          note: 'Erledigt.',
        },
      ],
    } as AnswerCard,
    routes: (url, init) => {
      if (init?.method === 'PATCH') {
        const id = decodeURIComponent(url.split('/').pop() ?? '')
        const status = JSON.parse(String(init.body)).status
        return { annotation: annotationView(id, Number(id.split('-')[1]), status) }
      }
      if (url.endsWith('/annotations')) {
        return {
          annotations: [
            annotationView('ann-4', 4, 'proposed'),
            annotationView('ann-5', 5, 'proposed'),
            annotationView('ann-6', 6, 'proposed'),
            annotationView('ann-9', 9, 'resolved'),
          ],
          canAnnotate: true,
        }
      }
      if (url.endsWith('/changes')) return { changes: [] }
      return {}
    },
    scenarios: [
      {
        name: 'taking one mark over',
        press: async (user) => user.click(await screen.findByRole('button', { name: 'Take over annotation 4' })),
      },
      {
        name: 'discarding one mark',
        press: async (user) => user.click(await screen.findByRole('button', { name: 'Discard annotation 5' })),
      },
      {
        name: 'taking every proposed mark over',
        press: async (user) => user.click(await screen.findByRole('button', { name: 'Take over all' })),
      },
      {
        name: 'discarding the rest, confirmed',
        press: async (user) => {
          await user.click(await screen.findByRole('button', { name: 'Discard the rest' }))
          await user.click(await screen.findByRole('button', { name: 'Discard' }))
        },
      },
      {
        name: 'undoing a change',
        press: async (user) => user.click(await screen.findByRole('button', { name: 'Undo the change to annotation 9' })),
      },
    ],
  },
}

class SeenObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  unobserve() {}
  disconnect() {}
}

describe('live card wiring', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IntersectionObserver', SeenObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has a case for every card classified as live', () => {
    const uncovered = LIVE_CARD_TYPES.filter((type) => !LIVE_CASES[type])
    expect(
      uncovered,
      `Card type(s) ${uncovered.join(', ')} are classified 'live' in CARD_INTERACTIVITY but have no case here. ` +
        'Add one that presses every control: a live card writes the OBJECT and never cardInteractions.',
    ).toEqual([])
  })

  for (const [type, testCase] of Object.entries(LIVE_CASES)) {
    for (const scenario of testCase.scenarios) {
      it(`${type}: ${scenario.name} writes the object and nothing on the message`, async () => {
        fetchMock = vi.fn((url: string, init?: RequestInit) =>
          Promise.resolve({ ok: true, status: 200, json: async () => testCase.routes(url, init) }),
        )
        vi.stubGlobal('fetch', fetchMock)
        const user = userEvent.setup()
        render(<AnswerCards cards={[testCase.card]} projectId="proj-1" messageId="msg-1" />)

        await scenario.press(user)

        await waitFor(() =>
          expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(true),
        )
        expect(setCardDecision).not.toHaveBeenCalled()
      })
    }
  }
})
