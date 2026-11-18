import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import type { MessageStages } from '@/lib/conversations/message-stages'
import { resetDecidedProposals } from '@/features/cards/decided-proposals'
import { PRODUCT_NAME } from '@/lib/brand'

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

vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

describe('AgentResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeFixture.projectId = null
    resetDecidedProposals()
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
})
