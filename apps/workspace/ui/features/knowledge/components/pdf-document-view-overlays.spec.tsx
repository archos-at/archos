import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  it('marks a cited region on its page, as shares of the page box (#433)', async () => {
    state.pages = [{ items: [] }, { items: [] }]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="plan.pdf"
        page={2}
        highlightColor="var(--source-project)"
        regions={[{ box: [0.1, 0.2, 0.5, 0.6], label: 'Grundriss EG' }]}
      />,
    )
    const mark = await screen.findByTestId('region-mark')
    expect(mark.closest('[data-page]')?.getAttribute('data-page')).toBe('2')
    expect(mark.style.left).toBe('10%')
    expect(mark.style.top).toBe('20%')
    expect(mark.style.width).toBe('40%')
    expect(mark.style.height).toBe('40%')
    expect(mark.style.getPropertyValue('--passage-tint')).toBe('var(--source-project)')
    expect(screen.getByText('Grundriss EG')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go to passage' })).toBeTruthy()
  })

  it('draws no region without a page to draw it on', async () => {
    state.pages = [{ items: [] }]
    render(
      <PdfDocumentView src="/api/doc.pdf" title="plan.pdf" regions={[{ box: [0.1, 0.2, 0.5, 0.6] }]} />,
    )
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    expect(screen.queryByTestId('region-mark')).toBeNull()
  })

  it("lays the caller's overlay over each page, told which page it is on", async () => {
    state.pages = [{ items: [] }, { items: [] }]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="plan.pdf"
        pageOverlay={(page) => (page === 2 ? <span data-testid="overlay-mark">pin on {page}</span> : null)}
      />,
    )
    const mark = await screen.findByTestId('overlay-mark')
    expect(mark.closest('[data-page]')?.getAttribute('data-page')).toBe('2')
    expect(screen.getAllByTestId('overlay-mark')).toHaveLength(1)
  })

  it("puts the caller's controls first in its own pill", async () => {
    state.pages = [{ items: [] }]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="plan.pdf"
        toolbarLead={<button type="button">Kommentar</button>}
      />,
    )
    const pill = await screen.findByTestId('pdf-floating-toolbar')
    expect(within(pill).getAllByRole('button')[0]).toHaveTextContent('Kommentar')
  })
})
