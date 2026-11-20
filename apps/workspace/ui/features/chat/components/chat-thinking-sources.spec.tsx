import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatThinking } from './ChatThinking'
import { useLayoutStore } from '@/features/layout/store'
import { MOCKUP_QUESTION, foldScene, mockupCitations, mockupScene } from '@/test-utils/work-list-scenes'
import { header, oibSources, tEn } from './chat-thinking.fixtures'

const motionPref = vi.hoisted(() => ({ reduced: false }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => motionPref.reduced }))

describe('ChatThinking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLayoutStore.setState({ showTechnicalReasoning: false })
    motionPref.reduced = false
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
})
