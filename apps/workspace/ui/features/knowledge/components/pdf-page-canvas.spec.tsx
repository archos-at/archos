import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPageCanvas } from './pdf-page-canvas'

vi.mock('../lib/pdfjs-runtime', () => ({
  readPageTextItems: vi.fn(() => new Promise(() => {})),
  renderTextLayer: vi.fn(() => new Promise(() => {})),
}))

interface RenderCall {
  width: number
  finish: () => void
  cancelled: boolean
}

function fakeDoc(): { doc: PDFDocumentProxy; calls: RenderCall[] } {
  const calls: RenderCall[] = []
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 850 * scale }),
    render: ({ viewport }: { viewport: { width: number } }) => {
      let finish = (): void => {}
      let fail = (_: unknown): void => {}
      const promise = new Promise<void>((resolve, reject) => {
        finish = resolve
        fail = reject
      })
      const call: RenderCall = { width: viewport.width, finish, cancelled: false }
      calls.push(call)
      return {
        promise,
        cancel: () => {
          call.cancelled = true
          fail(new Error('Rendering cancelled'))
        },
      }
    },
    cleanup: () => {},
  }
  return { doc: { getPage: () => Promise.resolve(page) } as unknown as PDFDocumentProxy, calls }
}

const canvasAt = (doc: PDFDocumentProxy, targetWidth: number) => (
  <PdfPageCanvas
    doc={doc}
    pageNumber={1}
    label="Page 1"
    targetWidth={targetWidth}
    defaultAspect={850 / 600}
    marks={null}
    searchMarks={null}
    regions={null}
    fuzzy={false}
    ping={0}
    onPassage={() => {}}
    onMiss={() => {}}
    onBase={() => {}}
    registerRef={() => {}}
    frameRef={{ current: null }}
    viewSignal={{ subscribe: () => () => {}, emit: () => {} }}
    moving={{ active: false }}
  />
)

const settle = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PdfPageCanvas', () => {
  it.each([
    ['settles within a pixel of the cancelled size', [1000, 1001]],
    ['bounces back to the cancelled size', [1000, 800, 1000]],
  ])('draws the page again when a render is cancelled and the width %s', async (_, widths) => {
    const { doc, calls } = fakeDoc()
    const view = render(canvasAt(doc, widths[0]))
    await settle(0)
    expect(calls).toHaveLength(1)
    for (const width of widths.slice(1)) {
      view.rerender(canvasAt(doc, width))
      await settle(20)
    }
    await settle(1000)
    expect(calls[0].cancelled).toBe(true)
    expect(calls.filter((call) => !call.cancelled)).toHaveLength(1)
  })

  it('keeps a finished page when the width moves by less than the raster tolerance', async () => {
    const { doc, calls } = fakeDoc()
    const view = render(canvasAt(doc, 1000))
    await settle(0)
    calls[0].finish()
    await settle(0)
    view.rerender(canvasAt(doc, 1001))
    await settle(1000)
    expect(calls).toHaveLength(1)
  })

  it('redraws a finished page after a real resize', async () => {
    const { doc, calls } = fakeDoc()
    const view = render(canvasAt(doc, 1000))
    await settle(0)
    calls[0].finish()
    await settle(0)
    view.rerender(canvasAt(doc, 800))
    await settle(1000)
    expect(calls.map((call) => Math.round(call.width))).toEqual([1000, 800])
  })
})
