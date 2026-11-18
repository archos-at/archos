// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { render, screen } from '@/test-utils'
import { exportedNames, nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'
import { VerdictHeaderCard } from './components/VerdictHeaderCard'

const CARDS_DIR = 'ui/features/cards/'

const hasIconSectionLabel = (file: string): boolean => {
  const source = parseSource(file)
  const tags = [...nodesOf(source, ts.isJsxOpeningElement), ...nodesOf(source, ts.isJsxSelfClosingElement)]
  return tags.some(
    (tag) =>
      ts.isIdentifier(tag.tagName) &&
      tag.tagName.text === 'SectionLabel' &&
      tag.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'icon'
      )
  )
}

describe('section marks in the answer are text only', () => {
  it('no card hands SectionLabel an icon, except the verdict whose gavel marks a ruling', () => {
    const cards = productionSources().filter((file) => file.startsWith(CARDS_DIR))
    expect(cards.length).toBeGreaterThan(0)
    const offenders = cards
      .filter((file) => !exportedNames(parseSource(file)).includes('VerdictHeaderCard'))
      .filter(hasIconSectionLabel)
    expect(offenders).toEqual([])
  })

  it('the verdict keeps its gavel on the subject, the label beside it', () => {
    render(
      createElement(VerdictHeaderCard, {
        verdict: '1,10 m',
        subject: 'Erforderliche Geländerhöhe',
        confidence: 'high',
        confidence_reason: null,
      })
    )

    const label = screen.getByText('Erforderliche Geländerhöhe')
    expect(label.classList).toContain('flex')
    expect(label.querySelector('svg')).toHaveClass('lucide-gavel')
  })
})
