import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { translatorFor } from '@/i18n/namespace'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useLayoutStore } from '@/features/layout/store'
import { storedStep } from '@/test-utils/wire-v2-steps'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import {
  MOCKUP_QUESTION,
  failedCallCitations,
  failedCallScene,
  foldScene,
  mockupCitations,
  mockupScene,
  singleReadCitations,
  singleReadScene,
} from '@/test-utils/work-list-scenes'
import { PRODUCT_NAME } from '@/lib/brand'

const tEn = translatorFor(chatCopy, 'en')
const plain = (text: string | null): string => (text ?? '').replace(/\u00A0/g, ' ')

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motionPref.reduced }))

const createStep = (overrides: Partial<StoredThinkingStep> = {}): StoredThinkingStep => ({
  id: 'step-1',
  userMessageId: 'msg-1',
  kind: 'tool',
  tool: 'acme_internal',
  isComplete: false,
  timestamp: '2024-01-15T14:30:00',
  ...overrides,
})

const oibSources = (hits: Array<{ name: string; detail: string }>) =>
  storedStep({
    id: 'sources:0:knowledge_search:1',
    kind: 'sources',
    tool: 'knowledge_search',
    round: 0,
    lanes: [
      { key: 'building_law_oib', label: 'OIB-Richtlinie', kind: 'building_law', hit_count: hits.length, sources: hits },
    ],
  })

const expandToSteps = async (user: ReturnType<typeof userEvent.setup>) => {
  useLayoutStore.setState({ showTechnicalReasoning: true })
  await user.click(screen.getByText(/^Trace( ·|$)/))
  await user.click(await screen.findByText('Intermediate steps'))
}

const stepList = () => screen.getByRole('list', { name: 'Thinking steps' })

const header = () => within(screen.getAllByRole('button')[0])

describe('ChatThinking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLayoutStore.setState({ showTechnicalReasoning: false })
    motionPref.reduced = false
  })

  describe('technical reasoning preference', () => {
    test('hides the technical steps section by default', async () => {
      const user = userEvent.setup()
      render(<ChatThinking steps={[createStep()]} />)
      await user.click(screen.getByText(/^Trace( ·|$)/))
      expect(screen.queryByText('Intermediate steps')).not.toBeInTheDocument()
    })

    test('shows the technical steps section when the preference is on', async () => {
      const user = userEvent.setup()
      useLayoutStore.setState({ showTechnicalReasoning: true })
      render(<ChatThinking steps={[createStep()]} />)
      await user.click(screen.getByText(/^Trace( ·|$)/))
      expect(await screen.findByText('Intermediate steps')).toBeInTheDocument()
    })
  })

  describe('turn-driven autoOpen (live expands, done collapses)', () => {
    const files = [{ id: 'file-1', fileName: 'plan.pdf' }]

    test('autoOpen expands the reasoning without a click (live turn)', () => {
      render(<ChatThinking steps={[createStep()]} autoOpen messageFiles={files} />)
      expect(screen.getByTestId('reasoning-flow')).toBeInTheDocument()
    })

    test('autoOpen=false keeps the reasoning collapsed (past/done turn)', () => {
      render(<ChatThinking steps={[createStep()]} autoOpen={false} messageFiles={files} />)
      expect(screen.queryByTestId('reasoning-flow')).not.toBeInTheDocument()
    })

    test('a live→done autoOpen transition collapses the reasoning', async () => {
      const { rerender } = render(
        <ChatThinking steps={[createStep()]} autoOpen messageFiles={files} />
      )
      expect(screen.getByTestId('reasoning-flow')).toBeInTheDocument()
      rerender(<ChatThinking steps={[createStep()]} autoOpen={false} messageFiles={files} />)
      await waitFor(() => expect(screen.queryByTestId('reasoning-flow')).not.toBeInTheDocument())
    })

    test('the fold: the turn closes what it opened, in the render the prop changes', () => {
      const { rerender } = render(
        <ChatThinking steps={[createStep()]} isThinking autoOpen messageFiles={files} />
      )
      rerender(
        <ChatThinking steps={[createStep()]} isThinking answering autoOpen={false} messageFiles={files} />
      )
      expect(screen.getByLabelText('Thinking in progress')).toBeInTheDocument()
      expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    })

    test('a HITL wait does not force the panel open: the choice is answered in its prompt card', () => {
      const { rerender } = render(
        <ChatThinking steps={[createStep()]} isThinking autoOpen={false} messageFiles={files} />
      )
      rerender(
        <ChatThinking steps={[createStep()]} isThinking={false} isWaiting autoOpen={false} messageFiles={files} />
      )
      expect(screen.queryByTestId('reasoning-flow')).not.toBeInTheDocument()
    })

    test('the live panel shows the whole graph: no capped, bottom-pinned window that cut its first steps off', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <ChatThinking steps={[createStep()]} isThinking autoOpen={false} messageFiles={files} />
      )
      await user.click(screen.getByRole('button', { expanded: false }))
      expect(container.querySelector('[class*="max-h-"]')).toBeNull()
      expect(container.querySelector('[class*="overflow-y-auto"]')).toBeNull()
    })

    test('while the turn works the header icon spins, as the working sign people watch for', () => {
      const { container } = render(<ChatThinking steps={[createStep()]} isThinking messageFiles={files} />)
      expect(screen.getByLabelText('Thinking in progress')).toBeInTheDocument()
      expect(container.querySelector('.animate-spin')).not.toBeNull()
    })

    test('a panel the reader opened is not folded or reopened by the turn', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <ChatThinking steps={[createStep()]} isThinking autoOpen={false} messageFiles={files} />
      )
      await user.click(screen.getByRole('button', { expanded: false }))
      expect(screen.getByTestId('reasoning-flow')).toBeInTheDocument()
      rerender(<ChatThinking steps={[createStep()]} isThinking autoOpen messageFiles={files} />)
      rerender(
        <ChatThinking steps={[createStep()]} isThinking answering autoOpen={false} messageFiles={files} />
      )
      expect(screen.getByTestId('reasoning-flow')).toBeInTheDocument()
    })
  })

  describe('the header from the send to the settle', () => {
    test('while the answer streams it stays live, names the panel, and its icon keeps spinning', () => {
      const { container } = render(<ChatThinking steps={[createStep()]} isThinking answering />)

      expect(screen.getByLabelText('Thinking in progress')).toBeInTheDocument()
      expect(screen.getByText('Trace')).toBeInTheDocument()
      expect(header().queryByText('Working on a response …')).not.toBeInTheDocument()
      expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull()
    })

    test('a stopped turn shows „Stopped", never the green check', () => {
      render(<ChatThinking steps={[createStep()]} isThinking={false} isStopped />)

      expect(screen.getByText('Stopped')).toBeInTheDocument()
      expect(screen.queryByText('Done')).not.toBeInTheDocument()
    })

    test('the timer counts from the question, so a late mount does not restart it', () => {
      const since = new Date(Date.now() - 12_000)
      render(<ChatThinking steps={[createStep()]} isThinking since={since} />)

      expect(screen.getByText('12s')).toBeInTheDocument()
    })

    test('at the settle the figure goes: no one checks an answer by its seconds (2026-10 value test)', async () => {
      const since = new Date(Date.now() - 12_000)
      const { rerender } = render(<ChatThinking steps={[createStep()]} isThinking since={since} />)
      expect(screen.getByText('12s')).toBeInTheDocument()
      rerender(
        <ChatThinking steps={[createStep()]} isThinking={false} since={since} answerDurationMs={12_400} />
      )
      await waitFor(() => expect(screen.queryByText('12s')).not.toBeInTheDocument())
    })

    test('the trigger is named by the phase, not the per-step phrase, which is never announced', () => {
      const steps = [
        storedStep({
          id: 'status:retrieval:0',
          kind: 'retrieval',
          round: 0,
          key: 'status.retrieval.withQuery',
          values: { corpus: 'knowledge', query: 'Fluchtweg' },
        }),
      ]
      render(<ChatThinking steps={steps} isThinking />)

      const trigger = screen.getAllByRole('button')[0]
      expect(trigger).toHaveAccessibleName(/^Thinking in progress · Trace\u00A0· 1\sstep$/)
      const status = screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite')
      expect(status).toHaveTextContent('Thinking in progress')
      expect(status).not.toHaveTextContent('Fluchtweg')
    })

    test('a restored turn grows no timer', () => {
      render(<ChatThinking steps={[createStep()]} isThinking={false} answerDurationMs={11_600} />)
      expect(screen.queryByText('12s')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    test('renders nothing when no steps provided', () => {
      render(<ChatThinking steps={[]} />)

      expect(screen.queryByText('Working on a response...')).not.toBeInTheDocument()
      expect(screen.queryByText('Done')).not.toBeInTheDocument()
      expect(screen.queryByText(/^Trace/)).not.toBeInTheDocument()
    })
  })

  describe('status header', () => {
    test('shows spinner and a live activity label when isThinking is true', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} isThinking={true} />)

      expect(screen.getByLabelText('Thinking in progress')).toBeInTheDocument()
      expect(screen.getByText('Working on a response …')).toBeInTheDocument()
      expect(screen.queryByText(/acme_internal/)).not.toBeInTheDocument()
    })

    test('shows the newest turn event the backend reported, in the reader\'s words', () => {
      const steps = [
        storedStep({
          id: 'status:retrieval:0',
          kind: 'retrieval',
          round: 0,
          key: 'status.retrieval.withQuery',
          values: { corpus: 'knowledge', query: 'Fluchtweg' },
        }),
        createStep({ id: 'tool:1', tool: 'knowledge_search' }),
      ]

      render(<ChatThinking steps={steps} isThinking={true} />)

      expect(screen.getByText(/^Searching .+: “Fluchtweg”$/)).toBeInTheDocument()
    })

    test('settled, the label stays the summary: no „Done" word moves it', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} isThinking={false} />)

      expect(screen.queryByLabelText('Thinking in progress')).not.toBeInTheDocument()
      const trigger = screen.getByRole('button')
      expect(trigger).toHaveAccessibleName(/Done · Trace/)
      expect(within(trigger).queryByText('Done')).not.toBeInTheDocument()
      expect(within(trigger).getAllByText(/^Trace/)).toHaveLength(1)
    })

    test('the answer streaming and the settle show the summary in the same place', () => {
      const steps = [createStep()]
      const { rerender } = render(<ChatThinking steps={steps} isThinking answering />)
      const before = within(screen.getByRole('button')).getByText(/^Trace/)

      rerender(<ChatThinking steps={steps} isThinking={false} answering />)

      expect(within(screen.getByRole('button')).getByText(/^Trace/)).toBe(before)
    })

    test.each([
      ['handed_off', tEn('thinking.handedOff')],
      ['refused', 'Not handled'],
      ['failed', 'Failed'],
    ] as const)('a turn that ended %s is not „Done"', (endedAs, word) => {
      render(<ChatThinking steps={[createStep()]} isThinking={false} endedAs={endedAs} />)

      const trigger = screen.getByRole('button')
      expect(within(trigger).getByText(word)).toBeInTheDocument()
      expect(trigger).not.toHaveAccessibleName(/Done/)
    })

    test('the trigger is marked for the lifecycle fixtures', () => {
      render(<ChatThinking steps={[createStep()]} isThinking />)
      expect(screen.getByRole('button')).toHaveAttribute('data-derivation-trigger')
    })

    test('defaults to isThinking true', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} />)

      expect(screen.getByLabelText('Thinking in progress')).toBeInTheDocument()
      expect(screen.getByText('Working on a response …')).toBeInTheDocument()
    })

    test('falls back to the generic working copy when no step can be phrased', () => {
      const unknownKey = storedStep({ id: 'status:x', kind: 'status', slot: 'x', key: 'status.nope' })
      render(<ChatThinking steps={[unknownKey]} isThinking />)

      expect(screen.getByText('Working on a response …')).toBeInTheDocument()
    })

    test('shows warning icon and interrupted text when isInterrupted is true', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} isThinking={false} isInterrupted={true} />)

      expect(header().getByText('Interrupted')).toBeInTheDocument()
      expect(screen.queryByText('Done')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Thinking in progress')).not.toBeInTheDocument()
    })

    test('isThinking takes priority over isInterrupted', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} isThinking={true} isInterrupted={true} />)

      expect(screen.getByText('Working on a response …')).toBeInTheDocument()
      expect(screen.queryByText('Interrupted')).not.toBeInTheDocument()
    })

    test('shows the calm "checking" copy while recovery is pending, not the lost notice (FIX 3)', () => {
      const steps = [createStep()]

      render(
        <ChatThinking
          steps={steps}
          isThinking={false}
          isInterrupted={true}
          isRecoveryPending={true}
        />
      )

      expect(header().getByText('Fetching the answer')).toBeInTheDocument()
      expect(
        screen.getByText(`${PRODUCT_NAME} is still working — the answer appears here as soon as it is ready …`)
      ).toBeInTheDocument()
      expect(screen.queryByText('Interrupted')).not.toBeInTheDocument()
      expect(
        screen.queryByText('This answer was not finished, and the server has none. Please send the question again.')
      ).not.toBeInTheDocument()
    })

    test('falls back to the lost/interrupted copy once recovery has settled (not pending)', () => {
      const steps = [createStep()]

      render(
        <ChatThinking
          steps={steps}
          isThinking={false}
          isInterrupted={true}
          isRecoveryPending={false}
        />
      )

      expect(header().getByText('Interrupted')).toBeInTheDocument()
      expect(
        screen.getByText('This answer was not finished, and the server has none. Please send the question again.')
      ).toBeInTheDocument()
      expect(screen.queryByText('Fetching the answer')).not.toBeInTheDocument()
    })

    test('shows clock icon and waiting text when isWaiting is true', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} isThinking={false} isWaiting={true} />)

      expect(header().getByText('Waiting for response')).toBeInTheDocument()
      expect(screen.queryByText('Done')).not.toBeInTheDocument()
      expect(screen.queryByText('Interrupted')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Thinking in progress')).not.toBeInTheDocument()
    })

    test('isWaiting takes priority over isInterrupted', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} isThinking={false} isWaiting={true} isInterrupted={true} />)

      expect(header().getByText('Waiting for response')).toBeInTheDocument()
      expect(screen.queryByText('Interrupted')).not.toBeInTheDocument()
    })

    test('isThinking takes priority over isWaiting', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} isThinking={true} isWaiting={true} />)

      expect(screen.getByText('Working on a response …')).toBeInTheDocument()
      expect(screen.queryByText('Waiting for response')).not.toBeInTheDocument()
    })
  })

  describe('collapse/expand toggle', () => {
    test('the header counts no steps, and no source is no clause', () => {
      render(<ChatThinking steps={[createStep(), createStep({ id: 'step-2' })]} />)

      expect(screen.getByText('Trace')).toBeInTheDocument()
      expect(screen.queryByText(/step/)).not.toBeInTheDocument()
      expect(screen.queryByText(/source/)).not.toBeInTheDocument()
    })

    test('step list is collapsed by default', () => {
      const steps = [createStep({ kind: 'status', tool: undefined, slot: 'decision:routing' })]

      render(<ChatThinking steps={steps} />)

      expect(screen.getByText('Trace')).toBeInTheDocument()
      expect(screen.queryByText('decision:routing')).not.toBeInTheDocument()
    })

    test('expands technical steps after second toggle', async () => {
      const user = userEvent.setup()
      const steps = [createStep({ kind: 'status', tool: undefined, slot: 'decision:routing' })]

      render(<ChatThinking steps={steps} />)

      await expandToSteps(user)

      expect(within(stepList()).getByText('decision:routing')).toBeVisible()
    })
  })

  describe('source fan-out', () => {
    test('a still-running turn never reports a source as unused', async () => {
      const user = userEvent.setup()
      const steps = [
        oibSources([{ name: 'OIB-RL_2_Brandschutz.pdf', detail: 'p.12' }]),
      ]

      const { rerender } = render(<ChatThinking steps={steps} isThinking={true} />)
      await user.click(screen.getByText(/^Trace( ·|$)/))
      expect(screen.queryByText(/retrieved, not cited/)).not.toBeInTheDocument()

      rerender(<ChatThinking steps={steps} isThinking={false} />)
      expect(screen.getByText(tEn('thinking.node.uncited.name', { count: 1 }))).toBeInTheDocument()
    })

    test('renders per-document source cards from traceLanes', async () => {
      const user = userEvent.setup()
      const steps = [
        oibSources([
                { name: 'OIB-RL_2_Brandschutz.pdf', detail: 'p.12' },
                { name: 'OIB-RL_2_Brandschutz.pdf', detail: 'p.18' },
              ]),
      ]

      render(<ChatThinking steps={steps} isThinking={false} />)

      expect(header().getByText(/^Trace ·/)).toHaveTextContent('Trace · 1 source')

      await user.click(screen.getByText(/^Trace( ·|$)/))

      const fold = screen.getByRole('button', {
        name: `${tEn('thinking.node.uncited.name', { count: 1 })} OIB-Richtlinie 2`,
      })
      expect(fold).toHaveAttribute('aria-expanded', 'false')
      expect(fold).toHaveAccessibleDescription(tEn('thinking.node.uncited.pill'))
      await user.click(fold)

      const name = screen.getByText('OIB-Richtlinie 2')
      expect(name).toBeVisible()
      expect(name).toHaveAttribute('title', expect.stringContaining('OIB-RL_2_Brandschutz.pdf'))
      expect(screen.queryByText('OIB-RL_2_Brandschutz.pdf')).not.toBeInTheDocument()
      expect(screen.queryByText('2 hits')).not.toBeInTheDocument()
      expect(screen.getByText(/^OIB(-Richtlinie| guideline)$/)).toBeVisible()
    })
  })

  describe('step list rendering', () => {
    test('names each row by its kind: a tool in the chip words, a slot verbatim', async () => {
      const user = userEvent.setup()
      const steps = [
        createStep({ id: '1', kind: 'status', tool: undefined, slot: 'decision:routing' }),
        createStep({ id: '2', tool: 'web_search_tool' }),
        createStep({ id: '3', tool: 'acme_internal' }),
        storedStep({ id: 'clarification', kind: 'clarification', max_turns: 3 }),
      ]

      render(<ChatThinking steps={steps} />)

      await expandToSteps(user)

      const list = within(stepList())
      expect(list.getByText('decision:routing')).toBeVisible()
      expect(list.getByText('Web search')).toBeVisible()
      expect(list.getByText('acme_internal')).toBeVisible()
      expect(list.getByText('Clarifying question')).toBeVisible()
    })

    test('shows timestamps for each step', async () => {
      const user = userEvent.setup()
      const steps = [createStep({ timestamp: '2024-01-15T14:30:00' })]

      render(<ChatThinking steps={steps} />)

      await expandToSteps(user)

      expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
    })

    test('step list has correct ARIA role', async () => {
      const user = userEvent.setup()
      const steps = [createStep()]

      render(<ChatThinking steps={steps} />)

      await expandToSteps(user)

      expect(screen.getByRole('list', { name: 'Thinking steps' })).toBeInTheDocument()
    })
  })

  describe('styling', () => {
    test('outer container has soft surface styling', () => {
      const steps = [createStep()]

      render(<ChatThinking steps={steps} />)

      const triggerText = screen.getByText('Trace')
      const outerDiv = triggerText.closest('.rounded-surface.shadow-xs')
      expect(outerDiv).toBeInTheDocument()
    })
  })

  describe('no attached-files footer', () => {
    test('lists no attachment as a chip', () => {
      const steps = [createStep()]
      const messageFiles = [
        { id: 'file-1', fileName: 'document.pdf' },
        { id: 'file-2', fileName: 'report.docx' },
      ]

      render(<ChatThinking steps={steps} defaultOpen messageFiles={messageFiles} />)

      expect(screen.getByTestId('reasoning-flow')).toBeInTheDocument()
      expect(screen.queryByText('document.pdf')).not.toBeInTheDocument()
      expect(screen.queryByText('report.docx')).not.toBeInTheDocument()
    })
  })

  describe('enabled data sources are never rendered as activity', () => {
    const enabled = ['web_search', 'knowledge_layer', 'ris']

    test('a turn with sources enabled but no executed search renders no source-activity chip', () => {
      const steps = [storedStep({ id: 'status:synthesis', kind: 'status', slot: 'synthesis', key: 'status.synthesis' })]

      render(
        <ChatThinking
          steps={steps}
          isThinking={false}
          defaultOpen
          enabledDataSources={enabled}
        />
      )

      expect(screen.queryByText('Ran:')).not.toBeInTheDocument()
      expect(screen.queryByText('Web search')).not.toBeInTheDocument()
      expect(screen.queryByText('Web Search')).not.toBeInTheDocument()
      expect(screen.queryByText('RIS')).not.toBeInTheDocument()
      expect(screen.queryByText('Knowledge')).not.toBeInTheDocument()
      expect(screen.queryByText('OIB knowledge')).not.toBeInTheDocument()
      expect(screen.queryByText('Selected Data Sources:')).not.toBeInTheDocument()
      expect(screen.queryByTestId('reasoning-flow')).not.toBeInTheDocument()
    })

    test('an executed web search IS reported — the fix removes the false claim, not the true one', () => {
      const steps = [
        createStep({ tool: 'web_search_tool', isComplete: true }),
      ]

      render(
        <ChatThinking
          steps={steps}
          isThinking={false}
          defaultOpen
          enabledDataSources={enabled}
        />
      )

      expect(screen.getByText('Web search')).toBeVisible()
    })

    test('enabled sources alone never conjure a derivation panel', () => {
      const { container } = render(
        <ChatThinking steps={[]} isThinking={false} enabledDataSources={enabled} />
      )

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('skill activity', () => {
    const skillStep = (name: string, payload: Record<string, unknown>) =>
      storedStep({ id: `skill:${name}`, kind: 'skill', skill: name, ...payload })

    test('each activated skill gets its own chip, named by its title', () => {
      render(
        <ChatThinking
          isThinking
          defaultOpen
          steps={[
            skillStep('oib-brandschutz', {
              phase: 'activated',
              title: 'Brandschutznachweis',
            }),
            skillStep('schallschutz', { phase: 'activated' }),
          ]}
        />
      )

      expect(screen.getByText('Skill: Brandschutznachweis')).toBeVisible()
      const bare = screen.getByText('schallschutz')
      expect(bare).toBeVisible()
      expect(bare).toHaveClass('font-mono')
      expect(screen.queryByText(/Use Skill/i)).not.toBeInTheDocument()
    })

    test('an offered-but-unused skill claims nothing', () => {
      const { container } = render(
        <ChatThinking
          isThinking
          defaultOpen
          steps={[skillStep('a', { phase: 'offered', count: 1 })]}
        />
      )

      expect(container.textContent).not.toContain('Skill')
    })

    test('the chips stand down once the answer lands — the disclosure owns the post-hoc claim', () => {
      render(
        <ChatThinking
          isThinking={false}
          defaultOpen
          steps={[
            skillStep('oib-brandschutz', {
              phase: 'loaded',
              title: 'Brandschutznachweis',
            }),
          ]}
        />
      )

      expect(screen.queryByText('Skill: Brandschutznachweis')).not.toBeInTheDocument()
    })
  })

  describe('reasoning chain nodes', () => {
    const expandChain = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByText(/^Trace( ·|$)/))
    }

    test('framing node restates the user question', async () => {
      const user = userEvent.setup()
      const steps = [createStep()]

      render(<ChatThinking steps={steps} userQuestion="Wie viele Rettungswege brauche ich?" />)

      await expandChain(user)

      expect(screen.getByText('Framing')).toBeVisible()
      expect(
        screen.getByText(/Wie viele Rettungswege brauche ich\?/)
      ).toBeVisible()
    })

    test('assessment node does NOT restate the confidence verdict (deduped to the answer card)', async () => {
      const user = userEvent.setup()
      const steps = [createStep()]

      render(<ChatThinking steps={steps} answerConfidence="high" />)

      await expandChain(user)

      expect(screen.queryByText('Confidence: high')).not.toBeInTheDocument()
    })

    test('the last card is „Grundlagen · Entwurf“: the cited law, what supports it, and what stayed open', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          isThinking={false}
          defaultOpen
          userQuestion={MOCKUP_QUESTION}
        />
      )
      expect(screen.getByText('Basis · Draft')).toBeVisible()
      expect(screen.getByText('Legal basis')).toBeVisible()
      const lines = screen.getAllByTestId('basis-group')
      expect(lines[0]).toHaveTextContent('1 OIB-Richtlinie 2, Ausgabe Mai 2023, Sec. 3.1.1')
      expect(
        within(lines[0]!).getByRole('button', { name: /^Source 1:/ })
      ).toHaveAttribute('data-citation-marker', '1')
      expect(screen.getByText('Supported by')).toBeVisible()
      expect(lines[1]).toHaveTextContent('2 Einreichplan EG, p. 2')
      expect(within(lines[1]!).getByRole('button', { name: /^Source 2:/ })).toBeVisible()
      expect(lines[0]).not.toHaveTextContent('[1]')
      const open = screen.getByTestId('basis-open')
      expect(open).toHaveTextContent(/OIB.Richtlinie 2, Ausgabe Mai 2023\b.*Brandabschnitt Tiefgarage/)
      expect(open).not.toHaveTextContent(/OIB.RL 2/)
      expect(document.body).not.toHaveTextContent(/proven|No information found/i)
    })

    test('assessment node is hidden without confidence or citations', async () => {
      const user = userEvent.setup()
      const steps = [createStep()]

      render(<ChatThinking steps={steps} userQuestion="Frage?" />)

      await expandChain(user)

      expect(screen.queryByText('Backed by')).not.toBeInTheDocument()
    })
  })

  describe("the Herleitung cites with the answer's marker", () => {
    const renderSettled = () =>
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          answerId="answer-1"
          isThinking={false}
          defaultOpen
          userQuestion={MOCKUP_QUESTION}
        />
      )

    test('a cited source card carries a marker button, not the text „[N]“', () => {
      renderSettled()
      const groups = Array.from(document.querySelectorAll('[data-source-card-markers]'))
      expect(groups.length).toBeGreaterThan(0)
      for (const group of groups) {
        expect(group.querySelector('button[data-citation-marker]')).not.toBeNull()
        expect(group).not.toHaveTextContent(/\[\d+\]/)
      }
    })

    test('no button sits inside another button', () => {
      renderSettled()
      expect(document.querySelectorAll('button button')).toHaveLength(0)
    })

    test("a press on a card's marker is not a tap on the card", async () => {
      const user = userEvent.setup()
      renderSettled()
      const marker = document.querySelector<HTMLElement>(
        '[data-source-card-markers] button[data-citation-marker]'
      )!
      const card = marker.closest<HTMLElement>('[data-source-card]')!
      expect(card).not.toHaveAttribute('data-link')
      await user.click(marker)
      expect(card).not.toHaveAttribute('data-link', 'selected')
      await user.click(card)
      expect(card).toHaveAttribute('data-link', 'selected')
    })

    const conceptCard = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-source-card]')).find((el) =>
        /Brandschutzkonzept/.test(el.textContent ?? '')
      )!
    const pressedRows = () =>
      document.querySelectorAll('[data-testid="work-row-link"][aria-pressed="true"]')

    test('a card is a keyboard control: Tab reaches it, Enter and Space toggle it and link its rows', async () => {
      const user = userEvent.setup()
      renderSettled()
      const card = conceptCard()
      const toggle = card.querySelector<HTMLElement>('[data-source-card-toggle]')!
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle).toHaveAccessibleName(/Brandschutzkonzept/)
      expect(toggle.childElementCount).toBe(0)
      expect(toggle.parentElement?.closest('button')).toBeNull()

      for (let i = 0; i < 100 && document.activeElement !== toggle; i++) await user.tab()
      expect(toggle).toHaveFocus()
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(pressedRows()).toHaveLength(0)

      await user.keyboard('{Enter}')
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
      expect(card).toHaveAttribute('data-link', 'selected')
      expect(pressedRows().length).toBeGreaterThan(0)

      await user.keyboard(' ')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      expect(card).not.toHaveAttribute('data-link')
      expect(pressedRows()).toHaveLength(0)
    })

    test('a receded card is dimmed once, never on top of the uncited dimming', async () => {
      const user = userEvent.setup()
      renderSettled()
      for (const fold of screen.getAllByTestId('uncited-fold'))
        await user.click(within(fold).getByRole('button'))
      expect(document.querySelectorAll('[data-source-card] .border-dashed').length).toBeGreaterThan(0)
      await user.click(conceptCard().querySelector<HTMLElement>('[data-source-card-toggle]')!)
      const receded = Array.from(document.querySelectorAll('[data-link="receded"]'))
      expect(receded.length).toBeGreaterThan(0)
      for (const el of receded) {
        expect(el).toHaveClass('opacity-60')
        expect(el.querySelector('.opacity-75, .opacity-40')).toBeNull()
      }
      for (const el of Array.from(document.querySelectorAll('.opacity-60, .opacity-75')))
        expect(el.parentElement?.closest('.opacity-60, .opacity-75')).toBeNull()
    })

    test('the open fold is a plain text button under the last uncited card, with no tab', async () => {
      const user = userEvent.setup()
      renderSettled()
      const fold = screen.getAllByTestId('uncited-fold')[0]!
      const column = fold.closest<HTMLElement>('[role="list"]')!
      expect(fold.querySelector('.card-eyebrow')).not.toBeNull()
      await user.click(within(fold).getByRole('button'))

      const open = within(column).getByTestId('uncited-fold')
      const hide = within(open).getByRole('button', { name: tEn('thinking.node.uncited.hide') })
      expect(hide).toHaveAttribute('aria-expanded', 'true')
      expect(hide).not.toHaveClass('border-dashed')
      expect(open.querySelector('.card-eyebrow')).toBeNull()
      const items = within(column).getAllByRole('listitem')
      expect(items.at(-1)).toBe(open)
      expect(items.at(-2)).toHaveAttribute('data-source-card')

      await user.click(hide)
      const closed = within(column).getByTestId('uncited-fold')
      expect(within(closed).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
      expect(closed.querySelector('.card-eyebrow')).not.toBeNull()
    })
  })

  describe('the header at a glance (2026-10)', () => {
    test('settled: the steps, what the answer cites, and the one worst warning', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          isThinking={false}
        />
      )
      const trigger = screen.getByRole('button')
      expect(within(trigger).getByText(/^Trace ·/)).toHaveTextContent(
        'Trace · 2 steps · 3 sources cited'
      )
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent(
        plain(tEn('thinking.derivationWarning.open', { count: 1 }))
      )
      expect(trigger).toHaveAccessibleName(
        new RegExp(
          `^Done · Trace\u00A0· 2\\ssteps\u00A0· 3\\ssources cited · ${tEn('thinking.derivationWarning.open', { count: 1 })}$`
        )
      )
      expect(within(trigger).getByText(/^Trace/).textContent).toMatch(/^Trace\u00A0· 2\ssteps\u00A0· /)
    })

    test('a failed call outranks an open point', () => {
      render(
        <ChatThinking
          steps={foldScene(failedCallScene())}
          citations={failedCallCitations()}
          isThinking={false}
        />
      )
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent('1 call failed')
    })

    test('no warning while the turn works', () => {
      render(<ChatThinking steps={foldScene(failedCallScene())} isThinking />)
      expect(screen.queryByTestId('derivation-warning')).not.toBeInTheDocument()
    })

    const check = (level: 'low' | 'medium', count = 2): ConfidenceCheck => ({
      status: 'judged',
      level,
      findings: ['Ausgabe April 2019 gilt seit 10. April 2021.', 'Mai 2023 ist nicht verbindlich.']
        .slice(0, count)
        .map((statement) => ({ statement, problem: 'unbacked' as const, reason: '', source: 'none' })),
    })
    const trigger = () => document.querySelector('[data-derivation-trigger]')!

    test('an answer its check rated low for unbacked statements is a warning, not a green check', () => {
      render(
        <ChatThinking
          steps={foldScene(failedCallScene())}
          citations={failedCallCitations()}
          confidenceCheck={check('low')}
          isThinking={false}
        />
      )
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent(
        plain(tEn('thinking.derivationWarning.unbacked', { count: 2 }))
      )
      expect(trigger().querySelector('.text-success')).toBeNull()
      expect(trigger().querySelector('.text-warning')).not.toBeNull()
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.flagged')} · `))
    })

    test('a mostly backed answer keeps its check, and the pill names what is unbacked', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          confidenceCheck={check('medium', 1)}
          isThinking={false}
        />
      )
      expect(trigger().querySelector('.text-success')).not.toBeNull()
      expect(screen.getByTestId('derivation-warning')).toHaveTextContent(
        plain(tEn('thinking.derivationWarning.unbacked', { count: 1 }))
      )
    })

    test('a clean check keeps the green check', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          confidenceCheck={{ status: 'judged', level: 'high', findings: [] }}
          isThinking={false}
        />
      )
      expect(trigger().querySelector('.text-success')).not.toBeNull()
    })

    test('a general-knowledge answer with findings stays „without research“ and carries the pill', () => {
      render(
        <ChatThinking
          steps={[]}
          confidenceCheck={check('low')}
          answerText="Eine Brandwand trennt Brandabschnitte."
          isThinking={false}
          userQuestion="Was ist eine Brandwand?"
          answerConfidence="low"
        />
      )
      const line = screen.getByTestId('derivation-no-research')
      expect(plain(line.textContent)).toContain(
        `${tEn('thinking.noResearch')} · ${plain(tEn('thinking.derivationWarning.unbacked', { count: 2 }))}`
      )
      expect(line.querySelector('.text-warning')).not.toBeNull()
    })

    const ledger: RetrievalLedger = [
      {
        index: 0,
        key: 'status.retrieval.withQuery',
        tools: ['knowledge_search'],
        corpora: [],
        docs: [{ name: 'Planungsbericht.pdf', detail: 'p.1' }],
        newDocs: ['Planungsbericht.pdf'],
        hits: 1,
        documents: 1,
      },
    ]
    const askBack = 'Das hängt vom Landesrecht ab.\n\nIn welchem Bundesland liegt das Bauvorhaben?'

    test('an answer that read documents and then asked back is a Rückfrage, not „without research“', () => {
      render(
        <ChatThinking
          steps={[]}
          retrievalLedger={ledger}
          confidenceCheck={check('medium', 1)}
          answerText={askBack}
          isThinking={false}
          userQuestion="Welche Ausgabe der OIB-Richtlinie 6 gilt?"
        />
      )
      expect(screen.queryByTestId('derivation-no-research')).not.toBeInTheDocument()
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.askedBack')} · `))
      expect(trigger().querySelector('.text-success')).toBeNull()
      expect(within(screen.getByRole('button')).getByText(tEn('thinking.askedBack'))).toBeInTheDocument()
    })

    test('a finding that sinks the answer outranks its question back', () => {
      render(
        <ChatThinking
          steps={[]}
          retrievalLedger={ledger}
          confidenceCheck={check('low')}
          answerText={askBack}
          isThinking={false}
          userQuestion="Welche Ausgabe der OIB-Richtlinie 6 gilt?"
        />
      )
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.flagged')} · `))
    })

    test('a cited answer under an assumption that invites a correction is no Rückfrage', () => {
      render(
        <ChatThinking
          steps={foldScene(mockupScene())}
          citations={mockupCitations()}
          answerText={'Ich gehe von Wien aus: mindestens 1,00 m [1].\n\nLiegt das Projekt in einem anderen Bundesland?'}
          isThinking={false}
        />
      )
      expect(trigger()).toHaveAccessibleName(new RegExp(`^${tEn('thinking.done')} · `))
      expect(trigger().querySelector('.text-success')).not.toBeNull()
    })

    test('an answer that asked back without researching says so in its one line', () => {
      render(
        <ChatThinking
          steps={[]}
          answerText="Welche Brandschutzklasse hat das Gebäude?"
          isThinking={false}
          userQuestion="Brauche ich eine Brandwand?"
          answerConfidence="medium"
        />
      )
      expect(screen.getByTestId('derivation-asked-back')).toHaveTextContent(
        tEn('thinking.askedBackHeadline')
      )
      expect(screen.queryByTestId('derivation-no-research')).not.toBeInTheDocument()
    })

    test('a turn that looked nothing up is one line that opens nothing', () => {
      render(
        <ChatThinking
          steps={[]}
          isThinking={false}
          userQuestion="Was ist eine Brandwand?"
          answerConfidence="medium"
        />
      )
      expect(screen.getByTestId('derivation-no-research')).toHaveTextContent(
        'Answered without researchGeneral expertise, no source cited'
      )
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    test('a turn of one call is that call: no graph', () => {
      render(
        <ChatThinking
          steps={foldScene(singleReadScene())}
          citations={singleReadCitations()}
          isThinking={false}
        />
      )
      const single = screen.getByTestId('derivation-single')
      expect(single).toHaveTextContent('Read: Brandschutzkonzeptp. 7 · cited 1')
      expect(within(single).getByRole('button')).toHaveAttribute('data-citation-marker', '1')
      expect(document.querySelector('[data-derivation-trigger]')).not.toBeInTheDocument()
      expect(screen.queryByTestId('reasoning-flow')).not.toBeInTheDocument()
    })

    test('a turn whose calls are rows has no tool chips beside them', () => {
      render(<ChatThinking steps={foldScene(mockupScene())} isThinking defaultOpen />)
      expect(screen.queryByText('Ran:')).not.toBeInTheDocument()
    })
  })

  describe('header label roll', () => {
    const withSources = (n: number) => [
      oibSources(Array.from({ length: n }, (_, i) => ({ name: `OIB-RL_${i + 1}.pdf`, detail: 'p.1' }))),
    ]
    const labels = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-derivation-label]'))
    const counts = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-derivation-count]')).map((n) => n.textContent)

    test('a new count keeps the words and rolls only the digits', async () => {
      const { container, rerender } = render(
        <ChatThinking steps={withSources(2)} isThinking answering />
      )
      const words = labels(container)[0]
      expect(words).toHaveTextContent('Trace · 2 sources')

      rerender(<ChatThinking steps={withSources(3)} isThinking={false} answering />)

      expect(labels(container)).toEqual([words])
      expect(counts(container)).toEqual(expect.arrayContaining(['2', '3']))
      await waitFor(() => expect(counts(container)).toEqual(['3']))
      expect(labels(container)).toEqual([words])
      expect(words).toHaveTextContent('Trace · 3 sources')
    })

    test('the plural is worded for one source and for several', () => {
      const { container, rerender } = render(<ChatThinking steps={withSources(1)} isThinking={false} />)
      expect(labels(container)[0]).toHaveTextContent(/^Trace · 1 source$/)

      rerender(<ChatThinking steps={withSources(2)} isThinking={false} />)
      expect(labels(container).at(-1)).toHaveTextContent(/^Trace · 2 sources$/)
    })

    test('a new label rolls in while the old one leaves: never zero labels', async () => {
      const { container, rerender } = render(<ChatThinking steps={withSources(2)} isThinking />)
      expect(labels(container)).toHaveLength(1)
      expect(labels(container)[0]).toHaveTextContent('Working on a response …')

      rerender(<ChatThinking steps={withSources(2)} isThinking answering />)

      const during = labels(container).map((n) => n.textContent)
      expect(during).toHaveLength(2)
      expect(during.map(plain)).toEqual(
        expect.arrayContaining(['Working on a response …', 'Trace · 2 sources'])
      )
      await waitFor(() => expect(labels(container)).toHaveLength(1))
      expect(labels(container)[0]).toHaveTextContent('Trace · 2 sources')
    })

    test('the shimmer runs on the live phrase only', () => {
      const { container, rerender } = render(<ChatThinking steps={withSources(2)} isThinking />)
      expect(labels(container)[0].querySelector('.animate-shimmer-window')).not.toBeNull()

      rerender(<ChatThinking steps={withSources(2)} isThinking={false} />)
      const summary = labels(container).find((n) => plain(n.textContent) === 'Trace · 2 sources')
      expect(summary?.querySelector('.animate-shimmer-window')).toBeNull()
    })

    test('reduced motion: the label and the count change at once', async () => {
      motionPref.reduced = true
      const { container, rerender } = render(<ChatThinking steps={withSources(2)} isThinking />)

      rerender(<ChatThinking steps={withSources(3)} isThinking={false} />)

      await waitFor(() => expect(labels(container)).toHaveLength(1), { timeout: 100 })
      expect(labels(container)[0]).toHaveTextContent('Trace · 3 sources')
      expect(counts(container)).toEqual(['3'])
    })
  })
})
