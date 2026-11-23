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

describe('PdfDocumentView touch gestures', () => {
  const fingers = (...points: Array<[number, number]>) =>
    points.map(([clientX, clientY], identifier) => ({ identifier, clientX, clientY }))

  it('shows a pinch as a transform while the fingers move, and lays the zoom out once, on release', async () => {
    state.pages = [{ items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    const frame = screen.getByTestId('pdf-scroll')
    const content = frame.querySelector<HTMLElement>('[data-page]')!.parentElement!

    fireEvent.touchStart(frame, { touches: fingers([100, 100], [200, 100]) })
    fireEvent.touchMove(frame, { touches: fingers([50, 100], [250, 100]) })
    expect(content.style.transform).toContain('scale(2)')
    expect(screen.getByText('100%')).toBeTruthy()

    fireEvent.touchEnd(frame, { touches: fingers([50, 100]) })
    fireEvent.touchEnd(frame, { touches: [] })
    expect(await screen.findByText('200%')).toBeTruthy()
    await waitFor(() => expect(content.style.transform).toBe(''))
  })

  it('does not read a pinch whose fingers landed one after the other as a two-finger tap', async () => {
    state.pages = [{ items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    const frame = screen.getByTestId('pdf-scroll')
    fireEvent.touchStart(frame, { touches: fingers([100, 100]) })
    fireEvent.touchStart(frame, { touches: fingers([100, 100], [200, 100]) })
    fireEvent.touchMove(frame, { touches: fingers([50, 100], [250, 100]) })
    fireEvent.touchEnd(frame, { touches: fingers([50, 100]) })
    fireEvent.touchEnd(frame, { touches: [] })
    expect(await screen.findByText('200%')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText('200%')).toBeTruthy()
  })

  it('zooms in one step on a double tap, and back to the fit from the ceiling', async () => {
    state.pages = [{ items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    const frame = screen.getByTestId('pdf-scroll')
    const page = frame.querySelector<HTMLElement>('[data-page]')!
    const tap = () => {
      fireEvent.touchStart(page, { touches: fingers([120, 140]) })
      fireEvent.touchEnd(page, { touches: [] })
    }
    tap()
    tap()
    expect(await screen.findByText('250%')).toBeTruthy()
  })

  it('leaves a tap on a control to the control', async () => {
    state.pages = [{ items: [] }]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        pageOverlay={() => (
          <button type="button" className="pointer-events-auto">
            Anmerkung 1
          </button>
        )}
      />,
    )
    const pin = await screen.findByRole('button', { name: 'Anmerkung 1' })
    for (let tap = 0; tap < 2; tap += 1) {
      fireEvent.touchStart(pin, { touches: fingers([120, 140]) })
      fireEvent.touchEnd(pin, { touches: [] })
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('keeps the drawing from painting over its own controls', async () => {
    state.pages = [{ items: [] }]
    render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    expect(screen.getByTestId('pdf-scroll')).toHaveClass('isolate')
  })
})
