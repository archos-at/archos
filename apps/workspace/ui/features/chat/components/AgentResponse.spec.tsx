import { render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import type { SourcePreviewChipProps } from './SourcePreview'
import type { MessageStages } from '@/lib/conversations/message-stages'
import type { AnswerCard } from '@/shared/cards/schemas'
import { CARD_PREVIEW_FIXTURES } from '@/features/cards/preview-fixtures'
import { useAnswerFileReferences } from '../hooks/use-answer-file-references'
import { resetDecidedProposals } from '@/features/cards/decided-proposals'
import { resetTurnNotes } from '../stores/turn-notes-store'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { proposalBase, PROPOSAL_ID, decidedByAnna } from '@/features/cards/components/proposal-test-kit'
import { PRODUCT_NAME } from '@/lib/brand'

const calculationCard = (title: string): AnswerCard => ({ ...CARD_PREVIEW_FIXTURES.calculation!, title } as AnswerCard)

const NOTED: MessageStages = {
  memoryReflection: {
    items: [{ id: 'mem-1', kind: 'decision', content: 'Fluchtweg über den Innenhof' }],
  },
}

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

vi.mock('./SourcePreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SourcePreview')>()
  return {
    ...actual,
    SourcePreviewChip: (props: SourcePreviewChipProps) => (
      <span data-signal={props.citation.document.tint}>
        <actual.SourcePreviewChip {...props} />
      </span>
    ),
  }
})

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

  describe('"Belegt durch" answer sources row (WS-3)', () => {
    const citations = [
      {
        id: 'c-1',
        url: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=1',
        content: '[RIS] BO Wien §111',
        timestamp: new Date('2026-07-17T10:00:00Z'),
        isCited: true,
      },
      {
        id: 'c-2',
        url: 'https://example.com/article',
        content: '[Web] Some article',
        timestamp: new Date('2026-07-17T10:00:00Z'),
        isCited: true,
      },
    ]

    test('renders provenance chips when the message carries citations', () => {
      render(<AgentResponse content="Cited answer" citations={citations} />)

      const row = screen.getByRole('list', { name: /sources this answer is backed by/i })
      expect(row).toBeInTheDocument()
      expect(screen.getByText('ris.bka.gv.at')).toBeInTheDocument()
      expect(screen.getByText('example.com')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /example\.com/i })).toHaveAttribute(
        'href',
        'https://example.com/article'
      )
    })

    test('renders no sources row when the message has no citation/source data', () => {
      render(<AgentResponse content="Plain answer" />)

      expect(
        screen.queryByRole('list', { name: /sources this answer is backed by/i })
      ).not.toBeInTheDocument()
    })

    test('renders the sources row in the inline variant too', () => {
      render(<AgentResponse content="Cited answer" variant="inline" citations={citations} />)

      expect(
        screen.getByRole('list', { name: /sources this answer is backed by/i })
      ).toBeInTheDocument()
    })
  })

  describe('merged provenance footer (default card)', () => {
    const citations = [
      {
        id: 'c-1',
        url: 'https://example.com/article',
        content: '[Web] Some article',
        timestamp: new Date('2026-07-17T10:00:00Z'),
        isCited: true,
      },
    ]

    test('shows the memory chip on the meta row, outside the details disclosure', async () => {
      const user = userEvent.setup()
      render(
        <AgentResponse
          content="Answer"
          conversationId="conv-1"
          stages={NOTED}
          answerConfidence="high"
          timestamp={new Date('2026-07-17T10:30:00')}
        />
      )

      const chip = screen.getByRole('button', { name: `${PRODUCT_NAME} noted 1 item` })
      const trigger = screen.getByTestId('answer-details-trigger')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(chip.closest('.min-h-6')).toContainElement(trigger)
      expect(chip.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()

      await user.click(chip)
      expect(await screen.findByText('Fluchtweg über den Innenhof')).toBeInTheDocument()
    })

    test('a memory-only turn shows the chip and no empty details trigger', () => {
      render(<AgentResponse content="Answer" stages={NOTED} />)
      expect(screen.getByTestId('memory-chip')).toBeInTheDocument()
      expect(screen.queryByTestId('answer-details-trigger')).not.toBeInTheDocument()
    })

    test('renders no meta row when it would hold nothing at all', () => {
      render(<AgentResponse content="Answer" />)

      expect(screen.queryByText(`${PRODUCT_NAME} noted`)).not.toBeInTheDocument()
      expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument()
      expect(screen.queryByText('Was this helpful?')).not.toBeInTheDocument()
      expect(screen.queryByTestId('answer-details-trigger')).not.toBeInTheDocument()
    })

    test('the meta row of a bare answer holds the copy action and nothing else', () => {
      render(<AgentResponse content="Answer" />)

      expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument()
      expect(screen.queryByTestId('answer-details-trigger')).not.toBeInTheDocument()
      expect(screen.queryByText(`${PRODUCT_NAME} noted`)).not.toBeInTheDocument()
      expect(screen.queryByText('Was this helpful?')).not.toBeInTheDocument()
      expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument()
    })

    test('renders no meta row at all while the answer is still streaming', () => {
      const { container } = render(<AgentResponse content="Answer" isStreaming />)

      expect(container.querySelector('[class*="animation-delay"]')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument()
    })

    test('reserves meta-row height while streaming so late chips do not jump the footer', () => {
      const { container } = render(<AgentResponse content="Answer" isStreaming />)

      const reserved = container.querySelector('.min-h-6')
      expect(reserved).not.toBeNull()
      expect(reserved?.className).not.toContain('animation-delay')
    })

    test('holds confidence and the timestamp behind ONE disclosure — memory and feedback stay out', async () => {
      const user = userEvent.setup()
      render(
        <AgentResponse
          content="Answer"
          messageId="m1"
          stages={NOTED}
          answerConfidence="high"
          timestamp={new Date('2026-07-17T10:30:00')}
        />
      )

      const metaRow = screen.getByRole('button', { name: 'Copy answer' }).closest('.min-h-6')
      expect(metaRow).not.toBeNull()
      expect(metaRow).toContainElement(screen.getByTestId('answer-details-trigger'))
      expect(metaRow).toContainElement(
        screen.getByRole('button', { name: 'Mark this answer as helpful' })
      )
      expect(metaRow).toContainElement(screen.getByTestId('memory-chip'))
      expect(screen.queryByText('Confidence: high')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('answer-details-trigger'))

      expect(screen.getByText('Confidence: high')).toBeInTheDocument()
      expect(screen.getByText(`${PRODUCT_NAME} noted`)).toBeInTheDocument()
      expect(screen.getByText(/^\d{1,2}:\d{2}/)).toBeInTheDocument()
    })

    test("a down-vote opens its disclosure as the meta row's own next line", async () => {
      const user = userEvent.setup()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ feedback: [] }) })
      )
      try {
        render(
          <AgentResponse
            content="Answer"
            messageId="m1"
            conversationId="conv-1"
            citations={citations}
          />
        )

        const thumb = screen.getByRole('button', { name: 'Mark this answer as not helpful' })
        await user.click(thumb)

        const metaRow = screen
          .getByRole('button', { name: 'Copy answer with full source references' })
          .closest('.min-h-6')
        const disclosure = (await screen.findByText('What was the problem?')).closest('.w-full')

        expect(disclosure?.parentElement).toBe(metaRow)
        expect(thumb.closest('.min-h-6')?.parentElement).toBe(metaRow)
        expect(disclosure).not.toContainElement(thumb)
      } finally {
        vi.unstubAllGlobals()
      }
    })

    test('the export actions, the thumbs and the details trigger share the wrapping meta row', () => {
      render(
        <AgentResponse
          content="Answer"
          messageId="m1"
          conversationId="conv-1"
          answerConfidence="high"
          timestamp={new Date('2026-07-17T10:30:00')}
          citations={citations}
        />
      )

      const copy = screen.getByRole('button', { name: 'Copy answer with full source references' })
      const trigger = screen.getByTestId('answer-details-trigger')
      const thumb = screen.getByRole('button', { name: 'Mark this answer as helpful' })
      const metaRow = copy.closest('.min-h-6')
      expect(metaRow).not.toBeNull()
      expect(metaRow).toContainElement(trigger)
      expect(metaRow).toContainElement(thumb)
      expect(metaRow?.className).toContain('flex-wrap')
    })

    test('the confidence pill stays out of the visible row until the disclosure opens; memory does not wait', async () => {
      const user = userEvent.setup()
      render(
        <AgentResponse
          content="Answer"
          messageId="m1"
          conversationId="conv-1"
          stages={NOTED}
          answerConfidence="high"
        />
      )

      expect(screen.queryByText('Confidence: high')).not.toBeInTheDocument()
      expect(screen.getByText(`${PRODUCT_NAME} noted`)).toBeInTheDocument()

      await user.click(screen.getByTestId('answer-details-trigger'))

      expect(screen.getByText('Confidence: high')).toBeInTheDocument()
      expect(screen.getAllByText(`${PRODUCT_NAME} noted`)).toHaveLength(1)
    })

    test('renders the feedback row in the open, beside the export actions', async () => {
      const user = userEvent.setup()
      render(
        <AgentResponse
          content="Answer"
          messageId="m1"
          timestamp={new Date('2026-07-17T10:30:00')}
        />
      )

      expect(screen.getByText('Was this helpful?')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Mark this answer as helpful' })
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument()

      await user.click(screen.getByTestId('answer-details-trigger'))
      expect(screen.getAllByText('Was this helpful?')).toHaveLength(1)
    })

    test('the sources row draws no divider inside the card (the body hairline already separates)', () => {
      render(<AgentResponse content="Cited answer" citations={citations} />)

      const row = screen.getByRole('list', { name: /sources this answer is backed by/i })
      expect(row.className).not.toContain('border-t')
    })

    test('the sources row keeps its own divider in the inline variant', () => {
      render(<AgentResponse content="Cited answer" variant="inline" citations={citations} />)

      const row = screen.getByRole('list', { name: /sources this answer is backed by/i })
      expect(row.parentElement?.className).toContain('border-t')
    })
  })

  describe('consolidated source list', () => {
    const answer = [
      'Garagen brauchen zwei Fluchtwege [1].',
      '',
      '## Quellen',
      '- [1] [KB] oib-rl_4_ausgabe_mai_2023.pdf, p.9',
    ].join('\n')

    test('the written sources section is not rendered a second time in the body', () => {
      render(<AgentResponse content={answer} messageId="m1" />)

      expect(screen.queryByText(/## Quellen/)).not.toBeInTheDocument()
      expect(screen.queryByText(/\[KB\]/)).not.toBeInTheDocument()
    })

    test('its entries become numbered, anchored chips of the provenance row', () => {
      render(<AgentResponse content={answer} messageId="m1" />)

      expect(
        screen.getByRole('list', { name: /sources this answer is backed by/i })
      ).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('OIB-Richtlinie 4, Ausgabe Mai 2023')).toBeInTheDocument()
      expect(document.getElementById('answer-source-m1-1')).not.toBeNull()
    })

    test('the cited page lives behind the click, not in the row', async () => {
      const user = userEvent.setup()
      render(<AgentResponse content={answer} messageId="m1" />)

      expect(screen.queryByText('p. 9')).not.toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: /preview source/i }))

      expect(await screen.findByText('p. 9')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /copy citation for/i })).toBeInTheDocument()
    })

    test('a written entry and its structured chip collapse into ONE row', () => {
      render(
        <AgentResponse
          content={answer}
          messageId="m1"
          citations={[
            {
              id: 'c1',
              content: '',
              timestamp: new Date(),
              isCited: true,
              kind: 'building_law',
              lane: 'building_law_oib',
              fileName: 'oib-rl_4_ausgabe_mai_2023.pdf',
              title: 'OIB-Richtlinie 4, Ausgabe Mai 2023',
              page: 9,
              number: 1,
            },
          ]}
        />
      )

      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      expect(screen.getByText('OIB-Richtlinie 4, Ausgabe Mai 2023')).toBeInTheDocument()
      expect(screen.queryByText('oib-rl_4_ausgabe_mai_2023.pdf')).not.toBeInTheDocument()
    })

    test('an answer with no written section keeps the compact chip row', () => {
      render(
        <AgentResponse
          content="Cited answer"
          citations={[
            {
              id: 'c-1',
              url: 'https://example.com/article',
              content: '[Web] Some article',
              timestamp: new Date('2026-07-17T10:00:00Z'),
              isCited: true,
            },
          ]}
        />
      )

      expect(document.querySelector('[id^="answer-source-"]')).toBeNull()
      expect(
        screen.getByRole('list', { name: /sources this answer is backed by/i })
      ).toBeInTheDocument()
    })
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

  describe('lede typesetting', () => {
    const LEDE = '[&>.markdown-content>p:first-child]:leading-[1.65]'
    const longAnswer = [
      'Für GK 4 gilt REI 90 für tragende Bauteile.',
      'A'.repeat(320),
      'B'.repeat(320),
    ].join('\n\n')

    const hasLede = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('div')).some((el) => el.className.includes(LEDE))

    test('a long prose answer gets its opening paragraph set as a lede', () => {
      const { container } = render(<AgentResponse content={longAnswer} />)

      expect(hasLede(container)).toBe(true)
    })

    test('a note is never a lede, however it opens', () => {
      const { container } = render(<AgentResponse content={longAnswer} routingDecision="meta" />)
      expect(hasLede(container)).toBe(false)

      const { container: direct } = render(
        <AgentResponse content={longAnswer} answerMeta={{ v: 1, kind: 'direct' }} />
      )
      expect(hasLede(direct)).toBe(false)
    })

    test('an answer that opens with a heading is left alone', () => {
      const { container } = render(<AgentResponse content={`## Ergebnis\n\n${longAnswer}`} />)

      expect(hasLede(container)).toBe(false)
    })

    test('a streaming answer decides its lede at its first words and never restyles it', () => {
      const { container, rerender } = render(
        <AgentResponse content={longAnswer.slice(0, 20)} isStreaming />
      )
      expect(hasLede(container)).toBe(true)

      rerender(<AgentResponse content={longAnswer} isStreaming />)
      expect(hasLede(container)).toBe(true)

      rerender(<AgentResponse content={longAnswer} />)
      expect(hasLede(container)).toBe(true)
    })

    test('a streaming answer waits until its opening can be read before deciding', () => {
      const { container, rerender } = render(<AgentResponse content="##" isStreaming />)
      expect(hasLede(container)).toBe(false)

      rerender(<AgentResponse content={`## Ergebnis\n\n${longAnswer}`} isStreaming />)
      expect(hasLede(container)).toBe(false)

      rerender(<AgentResponse content={`## Ergebnis\n\n${longAnswer}`} />)
      expect(hasLede(container)).toBe(false)
    })

    test('a summary shown while the answer streams is not taken back when the prose repeats it', () => {
      const summary = 'Für GK 4 gilt REI 90 für tragende Bauteile.'
      const meta = { v: 1 as const, summary, verdict: { value: 'REI 90', subject: 'Feuerwiderstand' } }
      const { rerender } = render(<AgentResponse content="" answerMeta={meta} isStreaming />)
      expect(screen.getByText(summary)).toBeInTheDocument()

      rerender(<AgentResponse content={longAnswer} answerMeta={meta} isStreaming />)
      rerender(<AgentResponse content={longAnswer} answerMeta={meta} />)
      expect(screen.getAllByText(summary).length).toBeGreaterThanOrEqual(1)
      expect(document.querySelector('header')?.textContent).toContain(summary)
    })

    test('a summary that repeats the opening is dropped before it is ever shown', () => {
      const summary = 'Für GK 4 gilt REI 90 für tragende Bauteile.'
      const meta = { v: 1 as const, summary, verdict: { value: 'REI 90', subject: 'Feuerwiderstand' } }
      render(<AgentResponse content={longAnswer} answerMeta={meta} />)
      expect(document.querySelector('header')?.textContent).not.toContain(summary)
    })
  })
  describe('answer copy actions', () => {
    const citations = [
      {
        id: 'copy-c1',
        content: '',
        timestamp: new Date('2026-08-18T09:00:00Z'),
        title: 'OIB-Richtlinie 2',
        fileName: 'oib-rl_2.pdf',
        collection: 'oib_knowledge',
        kind: 'building_law' as const,
        origin: 'kb' as const,
        page: 18,
        number: 1,
        isCited: true,
      },
    ]

    test('a completed answer offers a copy button', () => {
      render(<AgentResponse content="Die Antwort." />)

      expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument()
    })

    test('the citations-resolved action appears only when the answer has sources', () => {
      const { rerender } = render(<AgentResponse content="Die Antwort." />)
      expect(screen.queryByRole('button', { name: /source references/i })).not.toBeInTheDocument()

      rerender(<AgentResponse content="Die Antwort [1]." citations={citations} />)
      expect(screen.getByRole('button', { name: /source references/i })).toBeInTheDocument()
    })

    test('an answer that is still arriving cannot be copied', () => {
      render(<AgentResponse content="Die Antwort" isStreaming />)

      expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument()
    })

    test('the inline variant carries no copy actions', () => {
      render(<AgentResponse content="Die Antwort." variant="inline" citations={citations} />)

      expect(screen.queryByRole('button', { name: 'Copy answer' })).not.toBeInTheDocument()
    })
  })

  describe('the answer anatomy (answerMeta)', () => {
    const answerMeta = {
      v: 1,
      summary: 'In GK 4 gilt REI 60; maßgeblich ist das Fluchtniveau.',
      verdict: { value: 'REI 60', subject: 'Feuerwiderstand tragender Bauteile' },
      callout: { kind: 'deadline' as const, text: 'Binnen sechs Wochen anzuberaumen.' },
      takeaways: [
        { text: 'Maßgeblich ist das Fluchtniveau' },
        { text: 'Tragende Bauteile mindestens REI 60' },
      ],
    }

    test('renders the masthead above the prose and the rest after it', () => {
      const { container } = render(
        <AgentResponse
          content="REI 60 gilt, und maßgeblich ist das Fluchtniveau."
          answerMeta={answerMeta}
        />
      )
      const text = container.textContent ?? ''
      expect(text).toContain('REI 60')
      expect(text).toContain('Binnen sechs Wochen anzuberaumen.')
      expect(text).toContain('Maßgeblich ist das Fluchtniveau')
      expect(text.indexOf('REI 60')).toBeLessThan(text.indexOf('In GK 4 gilt REI 60'))
      expect(text.indexOf('In GK 4 gilt REI 60')).toBeLessThan(text.indexOf('REI 60 gilt,'))
      expect(text.indexOf('REI 60 gilt,')).toBeLessThan(text.indexOf('Binnen sechs Wochen'))
      expect(text.indexOf('Binnen sechs Wochen')).toBeLessThan(
        text.indexOf('Maßgeblich ist das Fluchtniveau')
      )
    })

    test('a summary holds the lede alone — the first paragraph takes no lede', () => {
      const longBody = `${'Ein ausreichend langer erster Absatz. '.repeat(20)}\n\nZweiter Absatz.`
      const { container } = render(<AgentResponse content={longBody} answerMeta={answerMeta} />)
      expect(container.querySelector('[class*="first-child\\]:leading-"]')).toBeNull()

      const { verdict, callout, takeaways } = answerMeta
      const { container: plain } = render(
        <AgentResponse content={longBody} answerMeta={{ v: 1, verdict, callout, takeaways }} />
      )
      expect(plain.querySelector('[class*="first-child\\]:leading-"]')).not.toBeNull()
    })

    test('an answer without anatomy renders exactly as before', () => {
      const { container } = render(<AgentResponse content="Nur Prosa." />)
      expect(container.textContent).toContain('Nur Prosa.')
    })

    test('the below-prose anatomy waits for the stream like unclaimed cards do', () => {
      const { container } = render(
        <AgentResponse content="REI 60 gilt." answerMeta={answerMeta} isStreaming />
      )
      expect(container.textContent).not.toContain('Binnen sechs Wochen')
    })

    test('a walkthrough does not wear the verdict gavel even if a verdict is present', () => {
      const { container } = render(
        <AgentResponse
          content="So legen Sie den Ordner an."
          answerMeta={{
            v: 1,
            kind: 'walkthrough',
            summary: 'Legen Sie die Pläne unter Einreichung ab.',
            verdict: { value: 'REI 60', subject: 'Feuerwiderstand tragender Bauteile' },
          }}
        />
      )
      expect(container.textContent).toContain('Legen Sie die Pläne unter Einreichung ab.')
      expect(container.textContent).not.toContain('Feuerwiderstand tragender Bauteile')
    })

    test('a body that claims the callout with [[callout]] takes it out of the after-prose block', () => {
      const { container } = render(
        <AgentResponse
          content={'Erster Absatz.\n\n[[callout]]\n\nZweiter Absatz.'}
          answerMeta={answerMeta}
        />
      )
      const text = container.textContent ?? ''
      expect(text).not.toContain('Binnen sechs Wochen')
      expect(text).toContain('Maßgeblich ist das Fluchtniveau')
    })

    test('a summary that restates the body’s opening is dropped from the masthead', () => {
      const { container } = render(
        <AgentResponse
          content="In GK 4 gilt REI 60."
          answerMeta={{ v: 1, kind: 'walkthrough', summary: 'In GK 4 gilt REI 60.' }}
        />
      )
      expect(container.textContent?.match(/In GK 4 gilt REI 60\./g)).toHaveLength(1)
      expect(container.querySelector('header')).toBeNull()
    })

    test('a citation-suffixed restatement is dropped too', () => {
      const { container } = render(
        <AgentResponse
          content="In GK 4 gilt REI 60."
          answerMeta={{ v: 1, kind: 'walkthrough', summary: 'In GK 4 gilt REI 60. [1]' }}
        />
      )
      expect(container.querySelector('header')).toBeNull()
      expect(container.textContent).toContain('In GK 4 gilt REI 60.')
    })

    test('the inline variant drops a restating summary from the masthead too', () => {
      const { container } = render(
        <AgentResponse
          content="In GK 4 gilt REI 60."
          variant="inline"
          answerMeta={{ v: 1, kind: 'walkthrough', summary: 'In GK 4 gilt REI 60.' }}
        />
      )
      expect(container.textContent?.match(/In GK 4 gilt REI 60\./g)).toHaveLength(1)
      expect(container.querySelector('header')).toBeNull()
    })

    test('a genuinely different summary still headlines the answer', () => {
      const { container } = render(
        <AgentResponse
          content="REI 60 gilt, und maßgeblich ist das Fluchtniveau."
          answerMeta={answerMeta}
        />
      )
      expect(container.querySelector('header')?.textContent).toContain('In GK 4 gilt REI 60')
    })
  })

  describe('the provenance row always keeps its lane tints', () => {
    const citations = [
      {
        id: 'hue-c1',
        content: '[KB] oib-rl_2.pdf, p.12',
        timestamp: new Date('2026-08-18T09:00:00Z'),
        title: 'OIB-Richtlinie 2',
        citationKey: 'oib-rl_2.pdf, p.12',
        fileName: 'oib-rl_2.pdf',
        collection: 'oib_knowledge',
        kind: 'building_law' as const,
        origin: 'kb' as const,
        page: 12,
        number: 1,
        isCited: true,
      },
    ]
    const takeaways = [
      { text: 'Maßgeblich ist das Fluchtniveau' },
      { text: 'Tragende Bauteile mindestens REI 60' },
    ]

    const chipSignal = (container: HTMLElement): string | null =>
      container.querySelector('[data-signal]')?.getAttribute('data-signal') ?? null

    test('one chromatic accent keeps the chips tinted', async () => {
      const { container } = render(
        <AgentResponse
          content="Maßgeblich ist das Fluchtniveau."
          citations={citations}
          answerMeta={{ v: 1, kind: 'walkthrough', takeaways }}
        />
      )
      expect(chipSignal(container)).toBe('oib')
    })

    test('a frist callout plus takeaways keep the chips tinted', async () => {
      const { container } = render(
        <AgentResponse
          content="Maßgeblich ist das Fluchtniveau."
          citations={citations}
          answerMeta={{
            v: 1,
            kind: 'walkthrough',
            callout: { kind: 'deadline' as const, text: 'Binnen sechs Wochen anzuberaumen.' },
            takeaways,
          }}
        />
      )
      expect(chipSignal(container)).toBe('oib')
    })

    test('a hinweis callout plus takeaways keep the chips tinted', async () => {
      const { container } = render(
        <AgentResponse
          content="Maßgeblich ist das Fluchtniveau."
          citations={citations}
          answerMeta={{
            v: 1,
            kind: 'walkthrough',
            callout: { kind: 'note' as const, text: 'Die Frist läuft ab Zustellung.' },
            takeaways,
          }}
        />
      )
      expect(chipSignal(container)).toBe('oib')
    })
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
