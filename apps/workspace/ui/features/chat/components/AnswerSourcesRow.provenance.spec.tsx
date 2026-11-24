import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { AgentResponse } from './AgentResponse'
import { asStoreState, type DeepPartial, type StoreSelector } from '@/test-utils/store-fixtures'
import type { ChatStoreWithHydration } from '../store'
import type { SourcePreviewChipProps } from './SourcePreview'
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

vi.mock('@/shared/components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

describe('AgentResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeFixture.projectId = null
    resetDecidedProposals()
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
})
