import { describe, expect, it } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nProvider } from '@/i18n'
import { VerdictHeaderCard } from './VerdictHeaderCard'

describe('VerdictHeaderCard', () => {
  it('renders the subject, the verdict and the confidence label', () => {
    render(
      <VerdictHeaderCard
        verdict="1,10 m"
        subject="Erforderliche Geländerhöhe"
        reference={{ document: 'OIB-Richtlinie 4', section: 'Pkt. 4.3' }}
        confidence="high"
        confidence_reason={null}
      />,
    )

    expect(screen.getByText('Erforderliche Geländerhöhe')).toBeInTheDocument()
    expect(screen.getByText('1,10 m')).toBeInTheDocument()
    expect(screen.getByText('hohe Sicherheit')).toBeInTheDocument()
    expect(screen.getByText('OIB-Richtlinie 4')).toBeInTheDocument()
  })

  it('sets the verdict at the largest step in the system, and steps it down for a long one', () => {
    const { unmount } = render(
      <VerdictHeaderCard verdict="1,10 m" subject="Geländerhöhe" confidence={null} />,
    )
    expect(screen.getByText('1,10 m')).toHaveClass('card-figure-30')
    unmount()

    const long = 'Hauptgeschoßfußbodenoberkante über 22 m'
    render(<VerdictHeaderCard verdict={long} subject="Hochhaus" confidence={null} />)
    expect(screen.getByText(long), `${long.length} characters cannot hold 30px`).toHaveClass(
      'card-figure-24',
    )
  })

  it('renders confidence as three segments filled to level, and still writes the word', () => {
    render(<VerdictHeaderCard verdict="REI 90" subject="Feuerwiderstand" confidence="medium" />)

    const row = screen.getByText('mittlere Sicherheit').parentElement
    const cells = row?.querySelectorAll('span[aria-hidden="true"] > span') ?? []
    expect(cells).toHaveLength(3)
    expect(Array.from(cells).map((cell) => cell.classList.contains('bg-foreground'))).toEqual([
      true,
      true,
      false,
    ])
  })

  it('leaves the gauge out entirely when the answer carries no confidence', () => {
    const { container } = render(
      <VerdictHeaderCard verdict="Nicht geregelt" subject="Wartungsleiter" confidence={null} />,
    )

    expect(
      container.querySelectorAll('span[aria-hidden="true"] > span'),
      'an empty gauge would read as "lowest confidence", which is a claim the card was not given',
    ).toHaveLength(0)
  })
})

const render = (ui: ReactElement) =>
  rtlRender(
    <I18nProvider initialLocale="de" fixedLocale>
      {ui}
    </I18nProvider>,
  )
