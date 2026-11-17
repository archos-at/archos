import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, test, expect } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { ErrorBanner } from './ErrorBanner'
import { storedStep } from '@/test-utils/wire-v2-steps'

const createStep = () => storedStep({ id: 'tool:1', kind: 'tool', tool: 'knowledge_search', status: 'ok' })

describe('ChatThinking escalation narration', () => {
  test('shows the escalation narration in the framing node when escalated', async () => {
    const user = userEvent.setup()
    render(
      <ChatThinking
        steps={[createStep()]}
        isThinking={false}
        userQuestion="Frage"
        escalationReason="Die erste Antwort war unzureichend."
      />
    )

    await user.click(screen.getByText(/^Trace( ·|$)/))
    expect(
      screen.getByText('Escalated to deep research: Die erste Antwort war unzureichend.')
    ).toBeInTheDocument()
  })
})

describe('ChatThinking mid-turn drop notice', () => {
  test('shows the compact resend notice on an interrupted turn', () => {
    render(<ChatThinking steps={[createStep()]} isThinking={false} isInterrupted />)

    expect(
      screen.getByText('This answer was not finished, and the server has none. Please send the question again.')
    ).toBeInTheDocument()
  })

  test('does not show the notice on a completed (non-interrupted) turn', () => {
    render(<ChatThinking steps={[createStep()]} isThinking={false} />)

    expect(
      screen.queryByText('This answer was not finished, and the server has none. Please send the question again.')
    ).not.toBeInTheDocument()
  })
})

describe('research.queue_full rejection banner', () => {
  test('renders the queue-full warning banner via the real error registry', () => {
    render(
      <ErrorBanner
        code="research.queue_full"
        message="The research queue is currently full. Please resend your request in a moment. Please try again in about 30 seconds."
      />
    )

    expect(screen.getByText('Research is busy')).toBeInTheDocument()
    expect(screen.getByText(/Please try again in about 30 seconds\./)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
