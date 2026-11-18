import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import {
  FAKE_FRAME_WIDTH,
  fakePdfjsRuntime,
  fakeTextRun as run,
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
  it('marks the cited passage on the cited page, in page coordinates', async () => {
    state.pages = [
      { items: [run('Vorbemerkungen zum Verfahren', 740, 160)] },
      { items: [run('Die Frist betraegt vier Wochen', 700, 180)] },
    ]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={2}
        highlight="Die Frist betraegt vier Wochen"
      />,
    )

    const mark = await screen.findByTestId('passage-mark')
    expect(mark.style.left).toBe('72px')
    expect(mark.style.top).toBe('88px')
    expect(mark.style.width).toBe('180px')
    expect(mark.style.height).toBe('12px')
    expect(mark.closest('[data-page]')?.getAttribute('data-page')).toBe('2')
  })

  it('wears the provenance tint it was handed', async () => {
    state.pages = [{ items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={1}
        highlight="Die Frist betraegt vier Wochen"
        highlightColor="var(--source-law)"
      />,
    )
    const mark = await screen.findByTestId('passage-mark')
    expect(mark.style.getPropertyValue('--passage-tint')).toBe('var(--source-law)')
  })

  it('wears the fuzzy dress when the match is a guess, and not when it is the passage', async () => {
    state.pages = [
      {
        items: [
          run(
            'Der Sachverstaendige erstattet Befund und Gutachten ueber die Standsicherheit des bestehenden Dachstuhls',
            700,
            400,
          ),
        ],
      },
    ]
    const { unmount } = render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={1}
        highlight="Sachverstaendiger erstattete Befund und Gutachten ueber die Standsicherheit des bestehende Dachstuhles"
      />,
    )
    const guess = await screen.findByTestId('passage-mark')
    expect(guess.className).toContain('passage-highlight--fuzzy')
    expect(guess.getAttribute('data-fuzzy')).toBe('true')
    unmount()

    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={1}
        highlight="Der Sachverstaendige erstattet Befund und Gutachten"
      />,
    )
    const hit = await screen.findByTestId('passage-mark')
    expect(hit.className).not.toContain('passage-highlight--fuzzy')
    expect(hit.getAttribute('data-fuzzy')).toBeNull()
  })

  it('marks nothing when the snippet is not on the page', async () => {
    state.pages = [{ items: [run('Vorbemerkungen zum Verfahren', 740, 160)] }]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={1}
        highlight="Die Brandschutzabnahme wurde durchgefuehrt"
      />,
    )
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    expect(screen.queryByTestId('passage-mark')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Go to passage' })).toBeNull()
  })

  it('offers a way back to the passage once one is marked', async () => {
    state.pages = [{ items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={1}
        highlight="Die Frist betraegt vier Wochen"
      />,
    )
    await screen.findByTestId('passage-mark')
    expect(screen.getByRole('button', { name: 'Go to passage' })).toBeTruthy()
  })

  it('does not re-reveal the passage when the reader zooms', async () => {
    state.pages = [{ items: [run('Die Frist betraegt vier Wochen', 700, 180)] }]
    const scrollTo = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    HTMLElement.prototype.scrollTo = scrollTo
    try {
      render(
        <PdfDocumentView
          src="/api/doc.pdf"
          title="doc.pdf"
          page={1}
          highlight="Die Frist betraegt vier Wochen"
        />,
      )
      await screen.findByTestId('passage-mark')
      await waitFor(() =>
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' })),
      )
      scrollTo.mockClear()

      fireEvent.click(screen.getByLabelText('Zoom in'))
      await waitFor(() => expect(screen.getByText('125%')).toBeTruthy())

      expect(screen.getByTestId('passage-mark')).toBeTruthy()
      expect(scrollTo).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Go to passage' }))
      expect(scrollTo).toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollTo', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
    }
  })

  it('looks one page either side when the cited page does not hold the passage', async () => {
    state.pages = [
      { items: [run('Vorbemerkungen zum Verfahren', 740, 160)] },
      { items: [run('Inhaltsverzeichnis', 740, 100)] },
      { items: [run('Die Frist betraegt vier Wochen', 700, 180)] },
    ]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={2}
        highlight="Die Frist betraegt vier Wochen"
      />,
    )

    const mark = await screen.findByTestId('passage-mark')
    expect(mark.closest('[data-page]')?.getAttribute('data-page')).toBe('3')
  })

  it('looks a second page out once both neighbours have come up empty', async () => {
    state.pages = [
      { items: [run('Titelblatt', 740, 160)] },
      { items: [run('Inhaltsverzeichnis', 740, 100)] },
      { items: [run('Die Frist betraegt vier Wochen', 700, 180)] },
    ]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={1}
        highlight="Die Frist betraegt vier Wochen"
      />,
    )

    const mark = await screen.findByTestId('passage-mark')
    expect(mark.closest('[data-page]')?.getAttribute('data-page')).toBe('3')
  })

  it('does not wander further than that', async () => {
    state.pages = [
      { items: [run('Vorbemerkungen zum Verfahren', 740, 160)] },
      { items: [run('Inhaltsverzeichnis', 740, 100)] },
      { items: [run('Zwischenblatt', 740, 90)] },
      { items: [run('Abkuerzungen', 740, 90)] },
      { items: [run('Die Frist betraegt vier Wochen', 700, 180)] },
    ]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={1}
        highlight="Die Frist betraegt vier Wochen"
      />,
    )
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(5))

    await waitFor(() => expect(screen.queryByTestId('passage-mark')).toBeNull())
  })

  it('says so when every page it could look at has come up empty', async () => {
    state.pages = [
      { items: [run('Vorbemerkungen zum Verfahren', 740, 160)] },
      { items: [run('Inhaltsverzeichnis', 740, 100)] },
      { items: [run('Anhang', 740, 90)] },
    ]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={2}
        highlight="Die Frist betraegt vier Wochen"
      />,
    )

    expect(await screen.findByText('Passage not found in the document')).toBeTruthy()
    expect(screen.queryByTestId('passage-mark')).toBeNull()
  })

  it('stays quiet about a passage it has not finished looking for', async () => {
    restoreObservers.current()
    restoreObservers.current = installLayoutObservers({
      frameWidth: FAKE_FRAME_WIDTH,
      intersecting: (target) => target.getAttribute('data-page') !== '3',
    })
    state.pages = [
      { items: [run('Vorbemerkungen zum Verfahren', 740, 160)] },
      { items: [run('Inhaltsverzeichnis', 740, 100)] },
      { items: [run('Die Frist betraegt vier Wochen', 700, 180)] },
    ]
    render(
      <PdfDocumentView
        src="/api/doc.pdf"
        title="doc.pdf"
        page={2}
        highlight="Die Frist betraegt vier Wochen"
      />,
    )
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(3))

    expect(screen.queryByText('Passage not found in the document')).toBeNull()
  })
})
