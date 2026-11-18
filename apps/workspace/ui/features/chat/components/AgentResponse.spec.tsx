import { render, screen } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import { calculationCard } from './AgentResponse.fixtures'
import { resetDecidedProposals } from '@/features/cards/decided-proposals'

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

  describe('a streaming answer', () => {
    test('an answer still streaming cannot be copied', () => {
      render(<AgentResponse content="Die Antwort ist ja, ab GK4." isStreaming />)

      expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument()
    })

    test('a card no marker claimed lands as soon as the streamed prose is complete', () => {
      const cards = [
        calculationCard('Nachgestellte Karte'),
      ]

      const prose = render(<AgentResponse content="Die " isStreaming />)
      expect(prose.container.textContent).not.toContain('Nachgestellte Karte')
      prose.unmount()

      const cardsWritten = render(<AgentResponse content="Die Antwort." cards={cards} isStreaming />)
      expect(cardsWritten.container.textContent).toContain('Nachgestellte Karte')
      cardsWritten.unmount()

      const finished = render(<AgentResponse content="Die Antwort." cards={cards} />)
      expect(finished.container.textContent).toContain('Nachgestellte Karte')
    })
  })
})

describe('a stopped answer', () => {
  test('draws no card and no „without source" row that were not shown before the press', () => {
    const { rerender, container } = render(<AgentResponse content="Die Antwort so weit." isStreaming />)
    rerender(
      <AgentResponse content="Die Antwort so weit." cards={[calculationCard('Nachgestellte Karte')]} stopped />
    )
    expect(container.textContent).not.toContain('Nachgestellte Karte')
    expect(screen.queryByText('Without source citation')).toBeNull()
    expect(screen.getByTestId('answer-stopped')).toBeInTheDocument()
  })

  test('keeps the unplaced cards the reader already had', () => {
    const cards = [calculationCard('Nachgestellte Karte')]
    const { rerender, container } = render(<AgentResponse content="Die Antwort." cards={cards} isStreaming />)
    expect(container.textContent).toContain('Nachgestellte Karte')
    rerender(<AgentResponse content="Die Antwort." cards={cards} stopped />)
    expect(container.textContent).toContain('Nachgestellte Karte')
  })

  test('restored from the thread, is drawn whole', () => {
    const { container } = render(
      <AgentResponse content="Die Antwort." cards={[calculationCard('Nachgestellte Karte')]} stopped />
    )
    expect(container.textContent).toContain('Nachgestellte Karte')
  })
})

describe('a failed answer', () => {
  test('keeps the words, dimmed, without the copy action or feedback', () => {
    const { rerender } = render(
      <AgentResponse content="Fluchtwege müssen nach OIB-Richtlinie 2" isStreaming messageId="m-1" />
    )
    rerender(<AgentResponse content="Fluchtwege müssen nach OIB-Richtlinie 2" failed messageId="m-1" />)
    const article = screen.getByTestId('answer-failed')
    expect(article).toHaveTextContent('Fluchtwege müssen nach OIB-Richtlinie 2')
    expect(article.querySelector('.bg-card')).toHaveClass('opacity-60')
    expect(screen.queryByRole('button', { name: 'Copy answer' })).toBeNull()
    expect(screen.queryByText('Without source citation')).toBeNull()
  })
})
