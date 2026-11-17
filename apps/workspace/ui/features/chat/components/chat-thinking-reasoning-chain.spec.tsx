import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { useLayoutStore } from '@/features/layout/store'
import { MOCKUP_QUESTION, foldScene, mockupCitations, mockupScene } from '@/test-utils/work-list-scenes'
import { createStep } from './chat-thinking.fixtures'

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motionPref.reduced }))

describe('ChatThinking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLayoutStore.setState({ showTechnicalReasoning: false })
    motionPref.reduced = false
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
})
