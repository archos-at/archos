import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { useLayoutStore } from '@/features/layout/store'
import { storedStep } from '@/test-utils/wire-v2-steps'
import { createStep, expandToSteps, stepList } from './chat-thinking.fixtures'

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motionPref.reduced }))

describe('ChatThinking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLayoutStore.setState({ showTechnicalReasoning: false })
    motionPref.reduced = false
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
})
