import { render, screen, waitFor, within } from '@/test-utils'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { useLayoutStore } from '@/features/layout/store'
import { storedStep } from '@/test-utils/wire-v2-steps'
import { PRODUCT_NAME } from '@/lib/brand'
import { createStep, header, oibSources, plain, tEn } from './chat-thinking.fixtures'

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motionPref.reduced }))

describe('ChatThinking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLayoutStore.setState({ showTechnicalReasoning: false })
    motionPref.reduced = false
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
