import { render, screen } from '@testing-library/react'
import { ShieldAlert } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { FactLine } from './fact-line'

describe('FactLine', () => {
  it.each(['warning', 'danger'] as const)(
    'draws a %s signal on its glyph and its words in ink, a step heavier',
    (tone) => {
      render(
        <FactLine icon={ShieldAlert} tone={tone} testId="line">
          Schadsoftware gefunden
        </FactLine>
      )
      const line = screen.getByTestId('line')
      // Signal-coloured words at 12px measured under AA's 4.5:1 (design-language.md, „Warning gold is a glyph colour“).
      expect(line).toHaveClass('text-foreground', 'font-medium')
      expect(line.className).not.toMatch(/(^|\s)text-(error|warning|destructive)(\s|$)/)
      expect(line.className).toMatch(
        tone === 'danger' ? /\[&>svg\]:text-error/ : /\[&>svg\]:text-warning/
      )
      expect(line).toHaveTextContent('Schadsoftware gefunden')
    }
  )

  it('passes data attributes through, so a caller keeps its own markers', () => {
    render(
      <FactLine icon={ShieldAlert} testId="line" data-state="not_clean">
        x
      </FactLine>
    )
    expect(screen.getByTestId('line')).toHaveAttribute('data-state', 'not_clean')
  })
})
