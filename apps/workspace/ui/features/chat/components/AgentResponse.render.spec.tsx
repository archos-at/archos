import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import type { AnswerCard } from '@/shared/cards/schemas'
import { calculationCard } from './AgentResponse.fixtures'
import { useAnswerFileReferences } from '../hooks/use-answer-file-references'
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

vi.mock('../hooks/use-answer-file-references', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-answer-file-references')>()
  return { ...actual, useAnswerFileReferences: vi.fn(actual.useAnswerFileReferences) }
})

vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

describe('AgentResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeFixture.projectId = null
    resetDecidedProposals()
  })

  describe('a read-only answer (somebody else\'s turn)', () => {
    const proposal = {
      type: 'memory_proposal',
      title: 'Merken?',
      content: 'Fluchtweg über den Innenhof',
      kind: 'decision',
      confidence: 'medium',
    } as unknown as AnswerCard

    test('offers no feedback even when it is handed a message id', () => {
      render(<AgentResponse content="Answer" messageId="m1" readOnly />)
      expect(
        screen.queryByRole('button', { name: 'Mark this answer as helpful' })
      ).not.toBeInTheDocument()
    })

    test('draws no card that can decide, even when it is handed a message id', () => {
      render(<AgentResponse content="Answer" messageId="m1" cards={[proposal]} readOnly />)
      expect(screen.getByText('Fluchtweg über den Innenhof')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Yes, remember org-wide' })).not.toBeInTheDocument()
    })

    test('still resolves the files it names in the reader\'s project', () => {
      storeFixture.projectId = 'p1'
      const hook = vi.mocked(useAnswerFileReferences)
      const real = hook.getMockImplementation()
      hook.mockImplementation(() => ({ fileNames: [], resolve: () => null }))
      try {
        render(<AgentResponse content="Siehe plan.pdf" readOnly />)
        expect(hook).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }))
      } finally {
        if (real) hook.mockImplementation(real)
      }
    })
  })

  test('renders response content', () => {
    render(<AgentResponse content="Here is your answer" />)

    expect(screen.getByText('Here is your answer')).toBeInTheDocument()
  })

  test('returns null for empty content', () => {
    render(<AgentResponse content="" />)

    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  test('returns null for whitespace-only content', () => {
    render(<AgentResponse content="   " />)

    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  test('displays timestamp when provided', async () => {
    const user = userEvent.setup()
    const timestamp = new Date('2024-01-15T14:30:00')

    render(<AgentResponse content="Response" timestamp={timestamp} />)
    await user.click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })

  test('a cut-off marks the details trigger instead of opening it under the reader', () => {
    render(<AgentResponse content="Response" timestamp="2024-01-15T14:30:00Z" researchTruncated />)
    const trigger = screen.getByTestId('answer-details-trigger')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('answer-details-attention')).toBeInTheDocument()
    expect(trigger).toHaveAccessibleName(/notes|Hinweisen/)
  })

  test('an answer without a warning carries no mark on its trigger', () => {
    render(<AgentResponse content="Response" timestamp="2024-01-15T14:30:00Z" />)
    expect(screen.queryByTestId('answer-details-attention')).toBeNull()
  })

  test('handles ISO string timestamp', async () => {
    const user = userEvent.setup()
    render(<AgentResponse content="Response" timestamp="2024-01-15T14:30:00Z" />)
    await user.click(screen.getByTestId('answer-details-trigger'))

    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })

  test('offers no way out of the thread', () => {
    render(<AgentResponse content="Response" />)

    expect(screen.queryByRole('button', { name: /report|bericht/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /progress|fortschritt/i })).not.toBeInTheDocument()
  })

  test('renders without timestamp', () => {
    render(<AgentResponse content="Response without timestamp" />)

    expect(screen.getByText('Response without timestamp')).toBeInTheDocument()
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument()
  })

  test('renders long content', () => {
    const longContent = 'This is a very long response. '.repeat(50)

    const { container } = render(<AgentResponse content={longContent} />)

    expect(container.textContent).toContain('This is a very long response. ')
  })

  test('renders the confidence chip for each level', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<AgentResponse content="Answer" answerConfidence="high" />)
    await user.click(screen.getByTestId('answer-details-trigger'))
    expect(screen.getByText('Confidence: high')).toBeInTheDocument()

    rerender(<AgentResponse content="Answer" answerConfidence="medium" />)
    expect(screen.getByText('Confidence: medium')).toBeInTheDocument()

    rerender(<AgentResponse content="Answer" answerConfidence="low" />)
    expect(screen.getByText('Confidence: low')).toBeInTheDocument()
  })

  test('renders no confidence chip when answerConfidence is absent (backward compatible)', () => {
    render(<AgentResponse content="Answer without a self-assessment" />)
    expect(screen.queryByText(/Confidence:/)).not.toBeInTheDocument()
  })

  test('renders the confidence chip in the inline variant too', async () => {
    const user = userEvent.setup()
    render(<AgentResponse content="Answer" variant="inline" answerConfidence="high" />)
    await user.click(screen.getByTestId('answer-details-trigger'))
    expect(screen.getByText('Confidence: high')).toBeInTheDocument()
  })

  test('renders unplaced cards after the answer body, not before it', () => {
    const cards = [
      calculationCard('Nachgestellte Karte'),
    ]

    const { container } = render(<AgentResponse content="Die Antwort." cards={cards} />)

    const body = container.textContent ?? ''
    expect(body.indexOf('Die Antwort.')).toBeGreaterThanOrEqual(0)
    expect(body.indexOf('Nachgestellte Karte')).toBeGreaterThan(body.indexOf('Die Antwort.'))
  })

  test('leaves a card the answer placed inline out of the block', () => {
    const cards = [
      calculationCard('Platzierte Karte'),
    ]

    render(<AgentResponse content={'Die Antwort.\n\n[[card:1]]'} cards={cards} />)

    expect(screen.queryByText('Platzierte Karte')).not.toBeInTheDocument()
  })

  test('shows the masthead of a streaming answer before its first word', () => {
    render(
      <AgentResponse
        content=""
        isStreaming
        answerMeta={{ v: 1, kind: 'walkthrough', topic: 'Zweiter Fluchtweg in GK 4' }}
      />
    )
    expect(screen.getByText('Zweiter Fluchtweg in GK 4')).toBeInTheDocument()
  })
})
