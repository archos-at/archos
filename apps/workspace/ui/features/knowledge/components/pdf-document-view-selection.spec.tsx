import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import {
  FAKE_FRAME_WIDTH,
  fakePdfjsRuntime,
  fakeTextRun as run,
  selectRenderedText,
  type FakePdfState,
} from '@/test-utils/pdfjs-fake'
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
  it('puts the page\'s own text over the bitmap, where it can be selected', async () => {
    state.pages = [{ items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)

    await selectRenderedText('Die Frist betraegt vier Wochen')
  })

  it('re-scales the text layer with the zoom instead of rebuilding it', async () => {
    state.pages = [{ items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    const layer = await screen.findByTestId('pdf-text-layer')
    await waitFor(() => expect(layer.style.getPropertyValue('--total-scale-factor')).toBe('1'))

    fireEvent.click(screen.getByLabelText('Zoom in'))

    await waitFor(() => expect(layer.style.getPropertyValue('--total-scale-factor')).toBe('1.25'))
    expect(screen.getByTestId('pdf-text-layer')).toBe(layer)
  })

  it('offers to copy a selection as a citation, with the page it came from', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    state.pages = [{ items: [] }, { items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]

    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        quoteFormat={({ text, page }) => `„${text}“ — doc.pdf, S. ${page}`}
      />,
    )
    await selectRenderedText('Die Frist betraegt vier Wochen')

    fireEvent.pointerUp(screen.getByTestId('pdf-scroll'))
    fireEvent.click(await screen.findByText('Copy as citation'))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '„Die Frist betraegt vier Wochen“ — doc.pdf, S. 2',
      ),
    )
    expect(await screen.findByText('Citation copied')).toBeTruthy()
  })

  it('offers nothing to a viewer that was given no way to cite', async () => {
    state.pages = [{ items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await selectRenderedText('Die Frist betraegt vier Wochen')

    fireEvent.pointerUp(screen.getByTestId('pdf-scroll'))
    expect(screen.queryByTestId('pdf-quote-bar')).toBeNull()
  })

  it('offers similar passages for a selection, with its words and page, and no citation where none is built', async () => {
    const onFindSimilar = vi.fn()
    state.pages = [{ items: [] }, { items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]

    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" onFindSimilar={onFindSimilar} />)
    await selectRenderedText('Die Frist betraegt vier Wochen')
    fireEvent.pointerUp(screen.getByTestId('pdf-scroll'))
    fireEvent.click(await screen.findByTestId('pdf-find-similar'))

    expect(onFindSimilar).toHaveBeenCalledWith({ text: 'Die Frist betraegt vier Wochen', page: 2 })
    expect(screen.getByRole('button', { name: /Check your projects/ })).toBeTruthy()
    expect(screen.queryByText('Copy as citation')).toBeNull()
  })

  it('does not offer similar passages for a few words, which say too little to find another like them', async () => {
    state.pages = [{ items: [run('Frist', 700, 40)] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" onFindSimilar={vi.fn()} quoteFormat={(q) => q.text} />)
    await selectRenderedText('Frist')
    fireEvent.pointerUp(screen.getByTestId('pdf-scroll'))

    expect(await screen.findByText('Copy as citation')).toBeTruthy()
    expect(screen.queryByTestId('pdf-find-similar')).toBeNull()
  })
})
