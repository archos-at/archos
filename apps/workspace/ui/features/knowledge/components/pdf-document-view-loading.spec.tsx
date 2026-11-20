import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { FAKE_FRAME_WIDTH, fakePdfjsRuntime, type FakePdfState } from '@/test-utils/pdfjs-fake'
import { PdfDocumentView } from './pdf-document-view'
import { capturePosthog } from '@/lib/analytics/posthog'

vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

const state = vi.hoisted((): FakePdfState => ({ fail: false, pages: [], destroyed: 0 }))

vi.mock('../lib/pdfjs-runtime', () => fakePdfjsRuntime(state))

const restoreObservers = { current: () => {} }

beforeEach(() => {
  vi.mocked(capturePosthog).mockClear()
  state.fail = false
  state.destroyed = 0
  state.pages = []
  state.password = undefined
  restoreObservers.current = installLayoutObservers({ frameWidth: FAKE_FRAME_WIDTH })
})

afterEach(() => {
  restoreObservers.current()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PdfDocumentView', () => {
  it('holds a page-shaped sheet while loading, replaced by the first page', async () => {
    state.pages = [{ items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    const sheet = screen.getByTestId('pdf-page-placeholder')
    expect(sheet.style.aspectRatio).toBe(`1 / ${Math.SQRT2}`)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    expect(screen.queryByTestId('pdf-page-placeholder')).toBeNull()
  })

  it('blocks the document from the session recorder, pages and text layer alike', async () => {
    state.pages = [{ items: [] }]
    const { container } = render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    expect(container.firstElementChild).toHaveClass('ph-no-capture')
  })

  it('reports document_opened once pdf.js has the document, with the kind and renderer only', async () => {
    state.pages = [{ items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="Plan_EG.pdf" />)
    expect(capturePosthog).not.toHaveBeenCalled()
    await waitFor(() => expect(capturePosthog).toHaveBeenCalledTimes(1))
    expect(capturePosthog).toHaveBeenCalledWith('document_opened', { kind: 'pdf', library: 'pdfjs' })
  })

  it('reports a hand-over to the browser\'s viewer as its own renderer', async () => {
    state.fail = true
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    fireEvent.click(await screen.findByRole('link', { name: 'Open in browser' }))
    expect(capturePosthog).toHaveBeenCalledWith('document_opened', { kind: 'pdf', library: 'browser' })
  })

  it('renders one frame per page of the document', async () => {
    state.pages = [{ items: [] }, { items: [] }, { items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(3))
    expect(screen.getByRole('group', { name: 'Page 3' })).toBeTruthy()
    expect(await screen.findByText('Page 1 of 3')).toBeTruthy()
  })

  it('says it could not open the document, offers the browser at the right page, and retries', async () => {
    state.fail = true
    state.pages = [{ items: [] }]
    const { container } = render(
      <PdfDocumentView src="/api/doc.pdf" title="doc.pdf" page={7} highlight="egal" />,
    )
    expect(await screen.findByText('This document could not be opened here')).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open in browser' }).getAttribute('href')).toBe(
      '/api/doc.pdf#page=7',
    )

    state.fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
  })

  it('leaves the failure to a host that owns one', async () => {
    state.fail = true
    const onLoadError = vi.fn()
    const { container } = render(
      <PdfDocumentView src="/api/doc.pdf" title="doc.pdf" onLoadError={onLoadError} />,
    )
    await waitFor(() => expect(onLoadError).toHaveBeenCalledTimes(1))
    expect(container.firstChild).toBeNull()
  })

  it('asks for the password of an encrypted document, and says when it is wrong', async () => {
    state.password = 'geheim'
    state.pages = [{ items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)

    const field = await screen.findByLabelText('Password')
    fireEvent.change(field, { target: { value: 'falsch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not correct.')

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'geheim' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
  })

  it('releases the document when the viewer goes away', async () => {
    state.pages = [{ items: [] }]
    const { unmount } = render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    unmount()
    await waitFor(() => expect(state.destroyed).toBe(1))
  })
})
