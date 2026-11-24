import { render, screen, waitFor, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { useLayoutStore } from '@/features/layout/store'
import { createStep, expandToSteps, stepList } from './chat-thinking.fixtures'

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motionPref.reduced }))

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

  describe('empty state', () => {
    test('renders nothing when no steps provided', () => {
      render(<ChatThinking steps={[]} />)

      expect(screen.queryByText('Working on a response...')).not.toBeInTheDocument()
      expect(screen.queryByText('Done')).not.toBeInTheDocument()
      expect(screen.queryByText(/^Trace/)).not.toBeInTheDocument()
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
})
