import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  it('says which page the reader is on, not how long the document is', async () => {
    restoreObservers.current()
    restoreObservers.current = installLayoutObservers({
      frameWidth: FAKE_FRAME_WIDTH,
      intersecting: (target) => target.getAttribute('data-page') === '2',
    })
    state.pages = [{ items: [] }, { items: [] }, { items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)

    expect(await screen.findByText('Page 2 of 3')).toBeTruthy()
  })

  describe('moving through the document', () => {
    const threePages = (): void => {
      state.pages = [{ items: [] }, { items: [] }, { items: [] }]
    }
    const pageField = (): HTMLInputElement => screen.getByTestId('pdf-page-input')

    it('goes to a page typed into the page field', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(pageField().value).toBe('1'))

      fireEvent.change(pageField(), { target: { value: '3' } })
      fireEvent.keyDown(pageField(), { key: 'Enter' })

      await waitFor(() => expect(pageField().value).toBe('3'))
      expect(await screen.findByText('Page 3 of 3')).toBeTruthy()
    })

    it('holds a page past the end to the last page', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(pageField().value).toBe('1'))
      fireEvent.change(pageField(), { target: { value: '99' } })
      fireEvent.keyDown(pageField(), { key: 'Enter' })
      await waitFor(() => expect(pageField().value).toBe('3'))
    })

    it('turns pages with the arrows either side of the field', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(pageField().value).toBe('1'))
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
      await waitFor(() => expect(pageField().value).toBe('2'))
    })

    it('answers PageDown, End and Home while the reader is in the document', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(pageField().value).toBe('1'))
      const frame = screen.getByTestId('pdf-scroll')

      fireEvent.keyDown(frame, { key: 'PageDown' })
      await waitFor(() => expect(pageField().value).toBe('2'))
      fireEvent.keyDown(frame, { key: 'End' })
      await waitFor(() => expect(pageField().value).toBe('3'))
      fireEvent.keyDown(frame, { key: 'Home' })
      await waitFor(() => expect(pageField().value).toBe('1'))
    })

    it('leaves the keys alone outside the viewer', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(pageField().value).toBe('1'))
      fireEvent.keyDown(document.body, { key: 'End' })
      expect(pageField().value).toBe('1')
    })

    it('zooms with + and -, and fits again with Cmd+0', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(pageField().value).toBe('1'))
      const frame = screen.getByTestId('pdf-scroll')

      fireEvent.keyDown(frame, { key: '+' })
      expect(await screen.findByText('125%')).toBeTruthy()
      fireEvent.keyDown(frame, { key: '+' })
      expect(await screen.findByText('150%')).toBeTruthy()
      fireEvent.keyDown(frame, { key: '0', metaKey: true })
      expect(await screen.findByText('100%')).toBeTruthy()
      fireEvent.keyDown(frame, { key: '-' })
      expect(await screen.findByText('75%')).toBeTruthy()
    })

    it('walks the zoom past 4x, where the old ceiling stopped a reader of plans', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(pageField().value).toBe('1'))
      const frame = screen.getByTestId('pdf-scroll')
      for (let press = 0; press < 9; press += 1) fireEvent.keyDown(frame, { key: '+' })
      expect(await screen.findByText('800%')).toBeTruthy()
      expect(screen.getByLabelText('Zoom in')).toBeDisabled()
    })

    it('fits the whole page on request, and says it is doing so', async () => {
      threePages()
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      const toggle = await screen.findByRole('button', { name: 'Fit whole page' })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('names every control it draws', async () => {
    state.pages = [{ items: [] }, { items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(2))
    const toolbar = screen.getByRole('group', { name: 'Document controls' })
    for (const name of [
      'Hide page overview',
      'Previous page',
      'Next page',
      'Zoom out',
      'Zoom in',
      'Fit whole page',
      'Find in document',
    ]) {
      expect(within(toolbar).getByRole('button', { name })).toBeTruthy()
    }
    expect(within(toolbar).getByRole('textbox', { name: 'Go to page, of 2' })).toBeTruthy()
    expect(within(toolbar).queryByRole('separator')).toBeNull()
  })

  it('lists the pages in a rail that marks the one being read', async () => {
    state.pages = [{ items: [] }, { items: [] }, { items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    const rail = await screen.findByRole('navigation', { name: 'Pages' })
    const thumbs = within(rail).getAllByRole('button')
    expect(thumbs).toHaveLength(3)
    expect(thumbs[0]).toHaveAttribute('aria-current', 'page')

    fireEvent.click(within(rail).getByRole('button', { name: 'Page 3' }))
    await waitFor(() => expect(within(rail).getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page'))

    fireEvent.click(screen.getByRole('button', { name: 'Hide page overview' }))
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  })
})
