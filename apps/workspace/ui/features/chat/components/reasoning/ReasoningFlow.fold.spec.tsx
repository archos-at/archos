import { fireEvent, render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, test, expect } from 'vitest'
import { ReasoningFlow } from './ReasoningFlow'
import { storedSteps } from '@/test-utils/wire-v2-steps'

const spineSteps = (n: number) =>
  storedSteps(
    Array.from({ length: n }, (_, i) => [
      {
        id: `status:retrieval:${i}`,
        kind: 'retrieval',
        round: i,
        key: 'status.retrieval.withQuery',
        values: { corpus: 'knowledge', query: `Suchbegriff ${i}` },
        tools: ['knowledge_search'],
        reason: `Folgerung ${i}.`,
      },
      {
        id: `sources:${i}`,
        kind: 'sources',
        round: i,
        tool: 'knowledge_search',
        lanes: [
          {
            key: 'building_law_oib',
            label: 'OIB-Richtlinie',
            kind: 'building_law',
            hit_count: 1,
            sources: [{ name: `Quelle_${i}.pdf` }],
          },
        ],
      },
    ]).flat()
  )

const toggles = () => screen.queryAllByTestId('reasoning-round-toggle')
const cards = () =>
  document.querySelectorAll('[data-source-card], [data-testid="uncited-fold"]').length

describe('the fold control', () => {
  test('is a button, named, and reports its state', () => {
    render(<ReasoningFlow steps={spineSteps(2)} userQuestion="Frage?" answerConfidence="high" />)
    const controls = toggles()
    expect(controls).toHaveLength(2)
    for (const control of controls) {
      expect(control.tagName).toBe('BUTTON')
      expect(control.getAttribute('aria-label')?.trim()).toBeTruthy()
      expect(control.getAttribute('aria-expanded')).toBe('true')
    }
  })

  test('a click folds the layer to its scent and a second click brings it back', async () => {
    const user = userEvent.setup()
    render(<ReasoningFlow steps={spineSteps(2)} userQuestion="Frage?" answerConfidence="high" />)
    expect(cards()).toBe(2)

    await user.click(toggles()[0]!)
    expect(toggles()[0]!.getAttribute('aria-expanded')).toBe('false')
    expect(cards()).toBe(1)
    expect(screen.getByText('Quelle 0')).toBeTruthy()
    expect(screen.queryByText(/Suchbegriff/)).toBeNull()

    await user.click(toggles()[0]!)
    expect(toggles()[0]!.getAttribute('aria-expanded')).toBe('true')
    expect(cards()).toBe(2)
  })

  test('the keyboard operates it — Enter on a focused control', () => {
    render(<ReasoningFlow steps={spineSteps(2)} userQuestion="Frage?" answerConfidence="high" />)
    const control = toggles()[0]!
    ;(control as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(control)
    fireEvent.click(control)
    expect(toggles()[0]!.getAttribute('aria-expanded')).toBe('false')
  })

  test('three rounds arrive expanded — evidence hidden by default reads as no evidence', () => {
    render(<ReasoningFlow steps={spineSteps(3)} userQuestion="Frage?" answerConfidence="high" />)
    expect(toggles().map((c) => c.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true'])
    expect(cards()).toBe(3)
  })

  test('a layer the reader folded stays folded', async () => {
    const user = userEvent.setup()
    render(<ReasoningFlow steps={spineSteps(3)} userQuestion="Frage?" answerConfidence="high" />)
    await user.click(toggles()[0]!)
    expect(toggles().map((c) => c.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'true'])
    expect(cards()).toBe(2)
  })

  test('one retrieval round is not a spine and has no fold control at all', () => {
    render(<ReasoningFlow steps={spineSteps(1)} userQuestion="Frage?" answerConfidence="high" />)
    expect(toggles()).toHaveLength(0)
  })
})
