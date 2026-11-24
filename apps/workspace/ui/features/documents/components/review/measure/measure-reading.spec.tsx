import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import { MeasureReadingLines, type ShownReading } from './measure-reading'

const READING: ShownReading = {
  value: 3,
  unit: 'm',
  low: 2.98,
  high: 3.02,
  provenance: 'vector_verified',
  scaleRatio: 100,
}

describe('a reading checked against the sheet', () => {
  it('says when the printed figure on the span agrees, and warns when it differs', () => {
    const { rerender } = render(<MeasureReadingLines reading={{ ...READING, printedCheck: { text: '3,00', agrees: true } }} />)
    expect(screen.getByTestId('measure-reading-printed')).toHaveTextContent('3,00')
    expect(screen.getByTestId('measure-reading-printed')).toHaveAttribute('data-agrees', 'true')

    rerender(<MeasureReadingLines reading={{ ...READING, printedCheck: { text: '3,20', agrees: false } }} />)
    expect(screen.getByTestId('measure-reading-printed')).toHaveAttribute('data-agrees', 'false')
  })

  it('shows the perimeter of an area and nothing for a distance', () => {
    const { rerender } = render(<MeasureReadingLines reading={{ ...READING, unit: 'm2', value: 12, low: 11.9, high: 12.1, perimeter: 14 }} />)
    expect(screen.getByTestId('measure-reading-perimeter')).toHaveTextContent('14')

    rerender(<MeasureReadingLines reading={READING} />)
    expect(screen.queryByTestId('measure-reading-perimeter')).toBeNull()
    expect(screen.queryByTestId('measure-reading-printed')).toBeNull()
  })
})
