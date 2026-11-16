import { fireEvent, render, screen } from '@/test-utils'
import { describe, expect, test } from 'vitest'
import { CitationDefectChart } from './citation-defect-chart'

const KINDS = ['citations_removed', 'answer_ungrounded', 'confidence_capped'] as const

const labels = {
  kindLabel: (kind: string) => kind,
  turnsLabel: (count: number) => `${count} turns`,
  findingsLabel: (count: number) => `${count} findings`,
  flaggedLabel: (count: number) => `${count} flagged`,
  emptyLabel: 'No citation findings in this window.',
  ariaLabel: 'Defects per day',
}

describe('CitationDefectChart', () => {
  test('labels the stack in findings, not turns, when one turn trips several checks', () => {
    render(
      <CitationDefectChart
        points={[
          {
            day: '2026-07-28',
            turns: 1,
            defectTurns: 1,
            byKind: { citations_removed: 1, answer_ungrounded: 1, confidence_capped: 1 },
          },
        ]}
        kinds={KINDS}
        {...labels}
      />
    )

    expect(screen.getByText('3 findings')).toBeDefined()
    expect(screen.queryByText('3 turns')).toBeNull()
    expect(screen.getByRole('button', { name: 'Jul 28: 3 findings' })).toBeDefined()
  })

  test('draws the legend inside the palette scope, so its swatches have a colour', () => {
    render(
      <CitationDefectChart
        points={[{ day: '2026-07-28', turns: 4, defectTurns: 2, byKind: { citations_removed: 2 } }]}
        kinds={KINDS}
        {...labels}
      />
    )

    const legendItem = screen.getAllByText('citations_removed').find((node) => node.closest('li'))
    expect(legendItem?.closest('.usage-viz')).not.toBeNull()
  })

  test('renders the empty label when no kind carries a finding', () => {
    render(
      <CitationDefectChart
        points={[{ day: '2026-07-28', turns: 12, defectTurns: 0, byKind: {} }]}
        kinds={KINDS}
        {...labels}
      />
    )

    expect(screen.getByText('No citation findings in this window.')).toBeDefined()
  })

  test('prints the newest day first, and a tap on another column moves the breakdown there', () => {
    render(
      <CitationDefectChart
        points={[
          { day: '2026-07-27', turns: 9, defectTurns: 2, byKind: { answer_ungrounded: 2 } },
          { day: '2026-07-28', turns: 4, defectTurns: 1, byKind: { citations_removed: 1 } },
        ]}
        kinds={KINDS}
        {...labels}
      />
    )

    const readout = screen.getByTestId('defect-readout')
    expect(readout).toHaveTextContent('Jul 28')
    expect(readout).toHaveTextContent('4 turns · 1 flagged')
    fireEvent.click(screen.getByRole('button', { name: 'Jul 27: 2 findings' }))
    expect(readout).toHaveTextContent('9 turns · 2 flagged')
    expect(readout).toHaveTextContent('answer_ungrounded2')
  })
})
