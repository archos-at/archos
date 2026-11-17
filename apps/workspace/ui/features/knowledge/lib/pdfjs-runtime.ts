import type * as PdfjsModule from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { RawTextItem } from './pdf-text-chunks'

export type Pdfjs = typeof PdfjsModule

const ASSET_BASE = '/pdfjs/'

let runtime: Promise<Pdfjs> | null = null

export const loadPdfjs = (): Promise<Pdfjs> => {
  runtime ??= import('pdfjs-dist/legacy/build/pdf.mjs')
    .then((pdfjs: Pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${ASSET_BASE}pdf.worker.min.mjs`
      return pdfjs
    })
    .catch((error: unknown) => {
      runtime = null
      throw error
    })
  return runtime
}

export const documentParameters = (url: string) => ({
  url,
  cMapUrl: `${ASSET_BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
})

export interface TextLayerHandle {
  destroy: () => void
}

export const renderTextLayer = async (
  page: PDFPageProxy,
  container: HTMLElement,
): Promise<TextLayerHandle> => {
  const pdfjs = await loadPdfjs()
  const layer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport: page.getViewport({ scale: 1 }),
  })
  void layer.render().catch(() => {})
  return {
    destroy: () => {
      layer.cancel()
      container.replaceChildren()
    },
  }
}

export const readPageTextItems = async (
  page: Pick<PDFPageProxy, 'streamTextContent'>,
): Promise<RawTextItem[]> => {
  const reader = page.streamTextContent().getReader()
  const items: RawTextItem[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return items
      for (const item of value.items) {
        if (!('str' in item)) continue
        const fontFamily = value.styles[item.fontName]?.fontFamily
        items.push({
          str: item.str,
          width: item.width,
          height: item.height,
          transform: item.transform.map(Number),
          ...(fontFamily ? { fontFamily } : {}),
        })
      }
    }
  } finally {
    reader.releaseLock()
  }
}
