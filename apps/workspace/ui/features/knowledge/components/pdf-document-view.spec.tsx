import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import {
  FAKE_FRAME_WIDTH,
  fakePdfjsRuntime,
  fakeTextRun as run,
  selectRenderedText,
  type FakePdfState,
} from '@/test-utils/pdfjs-fake'
import { PdfDocumentView, pointOnPage } from './pdf-document-view'
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

  it('releases the document when the viewer goes away', async () => {
    state.pages = [{ items: [] }]
    const { unmount } = render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
    await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(1))
    unmount()
    await waitFor(() => expect(state.destroyed).toBe(1))
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

  describe('finding words in the document', () => {
    beforeEach(() => {
      state.pages = [
        { items: [run('Zwei Fluchtwege je Nutzungseinheit', 700, 220)] },
        { items: [run('Brandabschnitte und Trennwände', 700, 200)] },
        { items: [run('Der zweite FLUCHTWEG führt über das Fenster', 700, 260)] },
      ]
    })

    it('opens on Cmd+F inside the viewer, counts every hit and walks them', async () => {
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      await waitFor(() => expect(document.querySelectorAll('[data-page]')).toHaveLength(3))

      fireEvent.keyDown(screen.getByTestId('pdf-scroll'), { key: 'f', metaKey: true })
      const field = await screen.findByRole('searchbox', { name: 'Search term' })
      fireEvent.change(field, { target: { value: 'fluchtweg' } })

      await waitFor(() => expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('1 of 2'))
      expect(screen.getAllByTestId('search-mark')).toHaveLength(2)
      expect(document.querySelectorAll('[data-testid="search-mark"][data-active]')).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
      expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('2 of 2')
      fireEvent.keyDown(field, { key: 'Enter' })
      expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('1 of 2')

      fireEvent.keyDown(field, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByTestId('pdf-search-bar')).toBeNull())
      expect(screen.queryAllByTestId('search-mark')).toHaveLength(0)
    })

    it('says so when nothing matches', async () => {
      render(<PdfDocumentView src="/api/doc.pdf" title="doc.pdf" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Find in document' }))
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search term' }), {
        target: { value: 'Stellplatz' },
      })
      await waitFor(() => expect(screen.getByTestId('pdf-search-count')).toHaveTextContent('No matches'))
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

describe('pointOnPage', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 }

  it('is the share of the page the click hit, top-left origin', () => {
    expect(pointOnPage(3, rect, 60, 45)).toEqual({ page: 3, x: 0.25, y: 0.25 })
  })

  it('clamps a click on the page edge onto the page', () => {
    expect(pointOnPage(1, rect, 0, 500)).toEqual({ page: 1, x: 0, y: 1 })
  })

  it('has no point on a page with no size yet', () => {
    expect(pointOnPage(1, { ...rect, width: 0 }, 60, 45)).toBeNull()
  })
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
