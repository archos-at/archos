import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import {
  FAKE_FRAME_WIDTH,
  fakePdfjsRuntime,
  fakeTextRun,
  type FakePdfState,
} from '@/test-utils/pdfjs-fake'
import { PdfViewerDialog } from './pdf-viewer-dialog'

const state = vi.hoisted((): FakePdfState => ({ fail: false, pages: [], destroyed: 0 }))

vi.mock('../lib/pdfjs-runtime', () => fakePdfjsRuntime(state))

const restoreObservers = { current: () => {} }

beforeEach(() => {
  state.pages = [{ items: [] }]
  restoreObservers.current = installLayoutObservers({ frameWidth: FAKE_FRAME_WIDTH })
})

afterEach(() => {
  restoreObservers.current()
})

describe('PdfViewerDialog', () => {
  it('renders the document in the in-app viewer when opened', async () => {
    render(
      <PdfViewerDialog
        open
        onOpenChange={() => {}}
        fileName="plan.pdf"
        src="https://example.test/plan.pdf"
      />,
    )
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('keeps the page fragment on the link out to the browser viewer', () => {
    render(
      <PdfViewerDialog
        open
        onOpenChange={() => {}}
        fileName="plan.pdf"
        src="https://example.test/plan.pdf"
        page={12}
      />,
    )
    const link = screen.getByRole('link', { name: /Open in new tab/i })
    expect(link.getAttribute('href')).toBe('https://example.test/plan.pdf#page=12')
  })

  it('passes the cited passage through so the viewer can mark it', async () => {
    state.pages = [{ items: [fakeTextRun('Die Frist betraegt vier Wochen', 700, 180)] }]
    render(
      <PdfViewerDialog
        open
        onOpenChange={() => {}}
        fileName="plan.pdf"
        src="https://example.test/plan.pdf"
        page={1}
        highlight="Die Frist betraegt vier Wochen"
        highlightColor="var(--source-law)"
      />,
    )
    const mark = await screen.findByTestId('passage-mark')
    expect(mark.style.getPropertyValue('--passage-tint')).toBe('var(--source-law)')
  })

  it('renders an image source in the image frame, untouched by the PDF path', () => {
    render(
      <PdfViewerDialog
        open
        onOpenChange={() => {}}
        fileName="foto.png"
        src="https://example.test/foto.png"
        isImage
      />,
    )
    expect(screen.getByAltText('foto.png').tagName).toBe('IMG')
    expect(document.querySelector('[data-testid="pdf-scroll"]')).toBeNull()
  })

  it('overrides the primitive sm width clamp so it is not capped at 512px', () => {
    render(
      <PdfViewerDialog
        open
        onOpenChange={() => {}}
        fileName="section.pdf"
        src="https://example.test/section.pdf"
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('sm:max-w-[calc(100vw-2*max(2.5vw,env(safe-area-inset-left),env(safe-area-inset-right)))]')
    expect(dialog.className).not.toContain('sm:max-w-lg')
  })
})
