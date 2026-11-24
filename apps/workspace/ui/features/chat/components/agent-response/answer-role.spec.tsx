import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from '../AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../../store'
import { resetDecidedProposals } from '@/features/cards/decided-proposals'

const storeFixture = vi.hoisted(() => ({ projectId: null as string | null }))

vi.mock('../../store', () => ({
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

  describe('response-kind distinction (routingDecision)', () => {
    test('draws no role mark over the answer: the kind is the article name alone', () => {
      const { container } = render(<AgentResponse content="Baurecht answer" routingDecision="shallow" />)

      expect(screen.getByRole('article', { name: 'Result' })).toBeInTheDocument()
      expect(screen.queryByText('Result')).toBeNull()
      expect(container.querySelector('article > .card-eyebrow')).toBeNull()
      expect(container.querySelector('article > .bg-primary')).toBeNull()
    })

    test('a meta reply is distinguished by its surface, not by a tab', () => {
      const { container } = render(<AgentResponse content="Hello there" routingDecision="meta" />)

      expect(screen.queryByText('Note')).toBeNull()
      expect(container.querySelector('article > .bg-muted')).not.toBeNull()
    })

    test('a shallow Baurecht answer is named "Result"', () => {
      render(<AgentResponse content="Baurecht answer" routingDecision="shallow" />)

      expect(screen.getByRole('article', { name: 'Result' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Note' })).not.toBeInTheDocument()
    })

    test('a meta reply is named "Note" instead of "Result"', () => {
      render(<AgentResponse content="Hello there" routingDecision="meta" />)

      expect(screen.getByRole('article', { name: 'Note' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Result' })).not.toBeInTheDocument()
    })

    test('the two kinds are named differently for the same content', () => {
      const { unmount } = render(<AgentResponse content="Same text" routingDecision="deep" />)
      expect(screen.getByRole('article', { name: 'Result' })).toBeInTheDocument()
      unmount()

      render(<AgentResponse content="Same text" routingDecision="meta" />)
      expect(screen.getByRole('article', { name: 'Note' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Result' })).not.toBeInTheDocument()
    })

    test('fallback: absent routingDecision renders exactly as a substantive answer', () => {
      render(<AgentResponse content="Legacy answer" />)

      expect(screen.getByRole('article', { name: 'Result' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Note' })).not.toBeInTheDocument()
    })

    test('fallback: an \'error\' routing keeps the default "Result" treatment', () => {
      render(<AgentResponse content="Something went wrong" routingDecision="error" />)

      expect(screen.getByRole('article', { name: 'Result' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Note' })).not.toBeInTheDocument()
    })

    test('kind=direct is named "Note" even on a shallow route', () => {
      render(
        <AgentResponse
          content="Hello there"
          routingDecision="shallow"
          answerMeta={{ v: 1, kind: 'direct', summary: 'Kurz die Lage.' }}
        />
      )

      expect(screen.getByRole('article', { name: 'Note' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Result' })).not.toBeInTheDocument()
    })

    test('kind=walkthrough is named "Answer", not "Result"', () => {
      render(
        <AgentResponse
          content="So legen Sie den Ordner an."
          routingDecision="shallow"
          answerMeta={{ v: 1, kind: 'walkthrough', summary: 'Pläne unter Einreichung ablegen.' }}
        />
      )

      expect(screen.getByRole('article', { name: 'Answer' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Result' })).not.toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Note' })).not.toBeInTheDocument()
    })

    test('kind=ruling stays "Result"', () => {
      render(
        <AgentResponse
          content="REI 60 gilt."
          routingDecision="shallow"
          answerMeta={{
            v: 1,
            kind: 'ruling',
            verdict: { value: 'REI 60', subject: 'Feuerwiderstand tragender Bauteile' },
          }}
        />
      )

      expect(screen.getByRole('article', { name: 'Result' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Answer' })).not.toBeInTheDocument()
    })

    test('kind=handoff is named "Note", not "Result"', () => {
      render(
        <AgentResponse
          content="Dafür starte ich eine Tiefenrecherche."
          routingDecision="shallow"
          answerMeta={{ v: 1, kind: 'handoff' }}
        />
      )

      expect(screen.getByRole('article', { name: 'Note' })).toBeInTheDocument()
      expect(screen.queryByRole('article', { name: 'Result' })).not.toBeInTheDocument()
    })
  })
})
