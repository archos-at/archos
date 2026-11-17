import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import { AuthorshipLine } from './authorship-line'
import { PRODUCT_NAME } from '@/lib/brand'

describe('AuthorshipLine', () => {
  it('says who wrote a generated report', () => {
    render(<AuthorshipLine authoredBy="agent" />)
    expect(screen.getByText(`Created by ${PRODUCT_NAME}`)).toBeInTheDocument()
  })

  it('says nothing about a file a person uploaded', () => {
    const { container } = render(<AuthorshipLine authoredBy="user" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says nothing when the listing does not carry authorship yet', () => {
    const { container } = render(<AuthorshipLine authoredBy={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is text, not a chip and not an avatar', () => {
    const { container } = render(<AuthorshipLine authoredBy="agent" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    expect(container.firstElementChild?.tagName).toBe('P')
  })
})
