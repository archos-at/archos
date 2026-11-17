import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IfcElementChip } from './ifc-element-chip'
import { parseElementLink } from '../lib/element-question'

function chip(href: string, label = 'AW 38'): void {
  const link = parseElementLink(href)
  if (!link) throw new Error(`not a model link: ${href}`)
  render(<IfcElementChip link={link}>{label}</IfcElementChip>)
}

describe('IfcElementChip', () => {
  it('links to the view the answer pointed at', () => {
    chip('/app/projects/p1/files?model=haus-a.ifc&element=1kTvXnbbzCWw8lcMd1dR4o&xray=1')
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      '/app/projects/p1/files?model=haus-a.ifc&element=1kTvXnbbzCWw8lcMd1dR4o&xray=1'
    )
  })

  it('rewrites a link written against the old /model route', () => {
    chip('/app/projects/p1/model?element=abc')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/app/projects/p1/files?element=abc')
  })

  it('keeps the answer’s own wording as the chip label', () => {
    chip('/app/projects/p1/model?element=abc', 'Brandwand BW-03')
    expect(screen.getByText('Brandwand BW-03')).toBeInTheDocument()
  })

  it('says out loud that it opens the element in the model', () => {
    chip('/app/projects/p1/model?element=abc')
    expect(screen.getByRole('link')).toHaveAccessibleName(/Open in the model/)
  })

  it('describes a storey link as a storey link', () => {
    chip('/app/projects/p1/model?storey=Erdgeschoss', 'Erdgeschoss')
    expect(screen.getByRole('link')).toHaveAccessibleName(/Open storey Erdgeschoss in the model/)
  })

  it('drops parameters the view does not define', () => {
    chip('/app/projects/p1/files?element=abc&utm_campaign=x')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/app/projects/p1/files?element=abc')
  })
})
