import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test-utils'
import { IngestFailureNotice } from './ingest-failure-notice'
import { PRODUCT_NAME } from '@/lib/brand'

describe('IngestFailureNotice', () => {
  it('says the category sentence and hides the stored text until Details is opened', async () => {
    const user = userEvent.setup()
    const raw =
      'office_rendition_required: Word and presentation files are indexed from their PDF rendition, and none could be read (conversion disabled or failed, or the download failed)'
    render(<IngestFailureNotice errorMessage={raw} />)

    expect(screen.getByText(/The PDF preview of this file couldn't be created/)).toBeInTheDocument()
    expect(screen.queryByTestId('ingest-failure-raw')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByTestId('ingest-failure-raw')).toHaveTextContent(raw)
  })

  it('gives Details a 44px row to a finger: on a phone it was 16px of 12px type', () => {
    render(<IngestFailureNotice errorMessage="office_rendition_required: none could be read" />)
    expect(screen.getByRole('button', { name: 'Details' })).toHaveClass('pointer-coarse:min-h-11')
  })

  it('puts the page counts into the unreadable-pages sentence', () => {
    render(<IngestFailureNotice errorMessage="pdf_pages_unreadable: 3 of 40 pages could not be read" />)
    expect(screen.getByText(/^3 of 40 pages couldn't be read/)).toBeInTheDocument()
  })

  it('says the generic sentence, with no Details, when there is no stored text', () => {
    render(<IngestFailureNotice errorMessage={null} />)
    expect(screen.getByText(`${PRODUCT_NAME} couldn't read this document, so search can't find it.`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
  })
})
