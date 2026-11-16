import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test-utils'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { DocumentLifecyclePosition } from './document-lifecycle-position'
import { PRODUCT_NAME } from '@/lib/brand'

function version(state: DocumentVersionState) {
  return { state }
}

describe('DocumentLifecyclePosition — the sentence', () => {
  it('points at the published version while a newer one waits for approval', () => {
    render(<DocumentLifecyclePosition version={version('in_review')} lifecycle="active" live />)

    const meaning = screen.getByTestId('document-lifecycle-meaning')
    expect(meaning).toHaveTextContent('Waiting for approval')
    expect(meaning).toHaveTextContent('answers from the published revision')
  })

  it('does not point at a published version when there is none', () => {
    render(<DocumentLifecyclePosition version={version('in_review')} lifecycle="active" />)

    const meaning = screen.getByTestId('document-lifecycle-meaning')
    expect(meaning).toHaveTextContent('Waiting for approval')
    expect(meaning).toHaveTextContent(`${PRODUCT_NAME} does not answer from it`)
    expect(meaning).not.toHaveTextContent('published revision')
  })

  it('says a published version is the basis for answers', () => {
    render(<DocumentLifecyclePosition version={version('published')} lifecycle="active" />)

    expect(screen.getByTestId('document-lifecycle-meaning')).toHaveTextContent(
      `${PRODUCT_NAME} answers from this revision.`,
    )
  })

  it('lets the item win over the version once it is retired', () => {
    render(<DocumentLifecyclePosition version={version('published')} lifecycle="archived" />)

    expect(screen.getByTestId('document-lifecycle-meaning')).toHaveTextContent('Retired')
  })

  it('says the given sentence instead when the document was replaced by a newer one', () => {
    render(
      <DocumentLifecyclePosition
        version={version('published')}
        lifecycle="active"
        sentence="Ältere Fassung."
      />,
    )

    expect(screen.getByTestId('document-lifecycle-meaning')).toHaveTextContent('Ältere Fassung.')
  })
})

describe('DocumentLifecyclePosition — the track', () => {
  it('fills one segment per stage the document has walked', () => {
    render(
      <DocumentLifecyclePosition version={version('approved')} lifecycle="active" />,
    )

    const track = screen.getByTestId('document-lifecycle-track')
    expect(track).toHaveAttribute('data-reached', '3')
    expect(track.querySelectorAll('[data-done]')).toHaveLength(3)
    expect(track.children).toHaveLength(4)
  })

  it('marks a sent-back version as stopped rather than as still walking', () => {
    render(
      <DocumentLifecyclePosition
        version={version('changes_requested')}
        lifecycle="active"
      />,
    )

    const track = screen.getByTestId('document-lifecycle-track')
    expect(track).toHaveAttribute('data-reached', '1')
    expect(track).toHaveAttribute('data-halted', 'true')
  })

  it('says nothing to a screen reader that the sentence does not', () => {
    render(<DocumentLifecyclePosition version={version('draft')} lifecycle="active" />)

    expect(screen.getByTestId('document-lifecycle-track')).toHaveAttribute('aria-hidden', 'true')
  })
})
