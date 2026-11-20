import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfPageNavigation, type PdfPageNavigationArgs } from './use-pdf-page-navigation'

function setup() {
  const frame = document.createElement('div')
  const scrollTo = vi.fn()
  frame.scrollTo = scrollTo as unknown as typeof frame.scrollTo
  const page = document.createElement('div')
  const args = (pagesSized: boolean): PdfPageNavigationArgs => ({
    focus: { page: 2, y: 0.5, key: 1 },
    onViewport: undefined,
    position: '',
    doc: { numPages: 3 } as unknown as PDFDocumentProxy,
    pagesSized,
    setCurrentPage: () => {},
    setAnnounced: () => {},
    scrollRef: { current: frame },
    pageRefs: { current: new Map([[2, page]]) },
  })
  return { args, scrollTo }
}

describe('usePdfPageNavigation', () => {
  it('scrolls to a focus only once the pages have their size', () => {
    const { args, scrollTo } = setup()
    const view = renderHook((props: PdfPageNavigationArgs) => usePdfPageNavigation(props), { initialProps: args(false) })
    expect(scrollTo).not.toHaveBeenCalled()
    view.rerender(args(true))
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})
