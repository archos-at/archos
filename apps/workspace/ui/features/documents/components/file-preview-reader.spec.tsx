import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { FilePreviewPane } from './file-preview-pane'
import { PRODUCT_NAME } from '@/lib/brand'

describe('FilePreviewPane — the reader on a phone', () => {
  const drawing = {
    id: 'doc-phone',
    filename: 'WBN_Grundriss_1OG_Index_C.pdf',
    displayName: null,
    fileSize: 2_380_000,
    contentType: 'application/pdf',
    status: 'ready',
    folderId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    errorMessage: null,
    summary: 'Grundriss 1. Obergeschoss, M 1:100.',
    pageCount: 1,
    chunkCount: null,
    contentTypes: null,
    tags: null,
    topics: null,
    capture: null,
  }
  const original = window.matchMedia
  const phone = (sideways = false) => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('40rem') || (sideways && query.includes('31.25rem') && !query.includes('40rem') && !query.includes('48rem')),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia
  }
  afterEach(() => {
    window.matchMedia = original
  })

  it('gives the document the screen: a one-line header, the actions at the thumb, the rail in a sheet', async () => {
    phone()
    render(<FilePreviewPane file={drawing} projectId="proj-1" onClose={() => {}} />)
    const header = screen.getByTestId('file-reader-header')
    expect(within(header).getByRole('heading')).toHaveAttribute('title', 'WBN_Grundriss_1OG_Index_C.pdf')
    expect(within(header).getByTestId('file-reader-close')).toBeInTheDocument()
    const bar = screen.getByTestId('file-reader-bar')
    expect(within(bar).getByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })).toBeInTheDocument()
    expect(screen.queryByTestId('file-preview-rail')).toBeNull()
    expect(screen.getByTestId('file-preview-well').className).not.toContain('50dvh')

    fireEvent.click(within(bar).getByTestId('file-reader-details'))
    const sheet = await screen.findByTestId('file-reader-details-sheet')
    expect(within(sheet).getByTestId('file-preview-rail')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: `Discuss with ${PRODUCT_NAME}` })).toBeNull()
  })

  it('on its side, moves the actions into the header: there is no height for a bar', () => {
    phone(true)
    render(<FilePreviewPane file={drawing} projectId="proj-1" onClose={() => {}} />)
    expect(screen.queryByTestId('file-reader-bar')).toBeNull()
    expect(within(screen.getByTestId('file-reader-header')).getByTestId('file-reader-actions')).toBeInTheDocument()
  })

  it('keeps the desktop layout off a phone', () => {
    render(<FilePreviewPane file={drawing} projectId="proj-1" onClose={() => {}} />)
    expect(screen.queryByTestId('file-reader-header')).toBeNull()
    expect(screen.getByTestId('file-preview-rail')).toBeInTheDocument()
  })
})
