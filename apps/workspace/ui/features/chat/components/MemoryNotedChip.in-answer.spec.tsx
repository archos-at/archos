import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import type { MessageStages } from '@/lib/conversations/message-stages'
import type { AnswerCard } from '@/shared/cards/schemas'
import { resetDecidedProposals } from '@/features/cards/decided-proposals'
import { resetTurnNotes } from '../stores/turn-notes-store'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { proposalBase, PROPOSAL_ID, decidedByAnna } from '@/features/cards/components/proposal-test-kit'
import { PRODUCT_NAME } from '@/lib/brand'

const storeFixture = vi.hoisted(() => ({ projectId: null as string | null }))

vi.mock('../store', () => ({
  useChatStore: vi.fn((selector?: StoreSelector<ChatStoreWithHydration>) => {
    const state: DeepPartial<ChatStoreWithHydration> = {
      currentConversation: null,
      projectId: storeFixture.projectId,
      patchConversationMessage: vi.fn(),
    }
    return selector ? selector(asStoreState<ChatStoreWithHydration>(state)) : state
  }),
}))

vi.mock('@/adapters/api', () => ({
  cancelJob: vi.fn(),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({
    accessToken: null,
  }),
}))

vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

describe('AgentResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeFixture.projectId = null
    resetDecidedProposals()
  })

  describe('the agent-noted chip for a memory card the server decides', () => {
    const NOTE = 'Fluchtweg über den Innenhof'
    const card = {
      type: 'memory_proposal',
      title: 'Merken?',
      content: NOTE,
      kind: 'decision',
      confidence: 'medium',
      proposal_id: PROPOSAL_ID,
    } as unknown as AnswerCard

    const serveProposal = (status: 'applied' | 'dismissed') =>
      server.use(
        http.get(`/api/proposals/${PROPOSAL_ID}`, () =>
          HttpResponse.json({
            proposal: {
              ...proposalBase(),
              kind: 'memory',
              payload: { scope: 'organization', kind: 'decision', content: NOTE, confidence: 'medium', supersedes: null },
              ...decidedByAnna(status, status === 'applied' ? [{ label: NOTE, ok: true, scope: 'organization' }] : null),
            },
          })
        )
      )

    test('lists the note once its receipt has read the proposal as applied', async () => {
      serveProposal('applied')
      render(<AgentResponse content="Answer" messageId="m1" cards={[card]} />)

      expect(await screen.findByText(`${PRODUCT_NAME} noted`)).toBeInTheDocument()
    })

    test('does not list a note whose proposal was dismissed', async () => {
      serveProposal('dismissed')
      render(<AgentResponse content="Answer" messageId="m1" cards={[card]} />)

      await screen.findByTestId('proposal-status')
      expect(screen.queryByText(`${PRODUCT_NAME} noted`)).not.toBeInTheDocument()
    })
  })

  describe('the noted chip for a personal note (ADR-0180)', () => {
    const CONVERSATION = 's-1'
    const NOTE = 'Leitet die Einreichplanung.'
    const stages: MessageStages = {
      memoryReflection: { items: [{ id: 'n-1', kind: 'decision', content: 'Die Bauherrschaft will ein Flachdach.' }] },
    }
    const asked: string[] = []
    const serveMyNotes = (items: unknown[]) =>
      server.use(
        http.get('/api/user/memory', ({ request }) => {
          asked.push(new URL(request.url).search)
          return HttpResponse.json({ items, nextCursor: null })
        })
      )

    beforeEach(() => {
      asked.length = 0
      resetTurnNotes()
    })

    test('shows the owner the note that was saved under this answer, marked as theirs alone', async () => {
      const user = userEvent.setup()
      serveMyNotes([
        { id: 'p-1', kind: 'profile', content: NOTE, provenanceType: 'distillation', sourceMessageId: 'm1' },
        { id: 'p-2', kind: 'preference', content: 'Unter einer anderen Antwort gemerkt.', provenanceType: 'agent', sourceMessageId: 'm0' },
      ])
      render(<AgentResponse content="Answer" messageId="m1" conversationId={CONVERSATION} stages={stages} />)

      await user.click(await screen.findByRole('button', { name: `${PRODUCT_NAME} noted 2 items` }))

      const mine = screen.getAllByTestId('memory-item').find((row) => row.textContent?.includes(NOTE))
      expect(mine).toHaveTextContent('Only you')
      expect(screen.queryByText('Unter einer anderen Antwort gemerkt.')).not.toBeInTheDocument()
      expect(asked).toEqual([`?sourceConversationId=${CONVERSATION}&limit=200`])
    })

    test('shows a colleague reading the same message the project’s note and no personal row', async () => {
      const user = userEvent.setup()
      serveMyNotes([])
      render(<AgentResponse content="Answer" messageId="m1" conversationId={CONVERSATION} stages={stages} readOnly />)

      await user.click(await screen.findByRole('button', { name: `${PRODUCT_NAME} noted 1 item` }))

      expect(screen.getAllByTestId('memory-item')).toHaveLength(1)
      expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
      expect(screen.queryByText('Only you')).not.toBeInTheDocument()
    })

    test('an answer nothing was saved under shows no chip (a temporary conversation keeps nothing)', async () => {
      serveMyNotes([])
      render(<AgentResponse content="Answer" messageId="m1" conversationId={CONVERSATION} />)

      await waitFor(() => expect(asked).toHaveLength(1))
      expect(screen.queryByTestId('memory-chip')).not.toBeInTheDocument()
    })
  })
})
