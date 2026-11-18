import type { PDFDocumentProxy } from 'pdfjs-dist'
import { documentFileUrl } from '@/lib/documents/urls'
import { documentParameters, loadPdfjs } from '@/features/knowledge/lib/pdfjs-runtime'
import { maxCanvasPixels, rasterFor, type Raster } from '@/features/knowledge/lib/pdf-raster'
import {
  NotComparableError,
  type CompareFile,
  type PageSize,
  type PageSource,
  type RenderHandle,
} from '../types'
import { compareKindOf } from './compare-kind'

export function pageRaster(size: PageSize, scale: number, pixelRatio: number): Raster {
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  return rasterFor({
    width: size.width * scale,
    height: size.height * scale,
    dpr: pixelRatio,
    maxPixels: maxCanvasPixels(coarse),
  })
}

const regionRaster = (region: { width: number; height: number }, pixelRatio: number): Raster => {
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  return rasterFor({ width: region.width, height: region.height, dpr: pixelRatio, maxPixels: maxCanvasPixels(coarse) })
}

const sizeCanvas = (canvas: HTMLCanvasElement, raster: Raster): void => {
  canvas.width = raster.width
  canvas.height = raster.height
}

async function openPdf(file: CompareFile, isRendition: boolean): Promise<PageSource> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument(documentParameters(documentFileUrl(file.id)))
  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (error) {
    void task.destroy()
    if (isRendition) throw new NotComparableError()
    throw error
  }
  return {
    pageCount: doc.numPages,
    pageSize: async (page) => {
      const view = (await doc.getPage(page)).getViewport({ scale: 1 })
      return { width: view.width, height: view.height }
    },
    render: (page, canvas, { scale, pixelRatio, region }): RenderHandle => {
      let cancel = (): void => {}
      const promise = doc.getPage(page).then(async (pdfPage) => {
        const unscaled = pdfPage.getViewport({ scale: 1 })
        const raster = region
          ? regionRaster(region, pixelRatio)
          : pageRaster({ width: unscaled.width, height: unscaled.height }, scale, pixelRatio)
        const viewport = pdfPage.getViewport({
          scale: scale * raster.ratio,
          offsetX: region ? -region.x * raster.ratio : 0,
          offsetY: region ? -region.y * raster.ratio : 0,
        })
        canvas.width = region ? raster.width : Math.floor(viewport.width)
        canvas.height = region ? raster.height : Math.floor(viewport.height)
        const render = pdfPage.render({ canvas, viewport })
        cancel = () => render.cancel()
        await render.promise.catch(() => {})
      })
      return { promise, cancel: () => cancel() }
    },
    destroy: () => {
      void task.destroy()
    },
  }
}

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image failed to load'))
    image.src = url
  })

async function openImage(file: CompareFile): Promise<PageSource> {
  const response = await fetch(`/api/documents/${encodeURIComponent(file.id)}/preview`)
  if (!response.ok) throw new Error(`preview ${response.status}`)
  const body: unknown = await response.json()
  const url = typeof body === 'object' && body !== null ? (body as { url?: unknown }).url : null
  if (typeof url !== 'string') throw new Error('preview carried no url')
  const image = await loadImage(url)
  const size: PageSize = {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  }
  return {
    pageCount: 1,
    pageSize: async () => size,
    render: (_page, canvas, { scale, pixelRatio, region }): RenderHandle => {
      sizeCanvas(canvas, region ? regionRaster(region, pixelRatio) : pageRaster(size, scale, pixelRatio))
      const context = canvas.getContext('2d')
      if (context) {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        if (region) {
          context.drawImage(image, region.x / scale, region.y / scale, region.width / scale, region.height / scale, 0, 0, canvas.width, canvas.height)
        } else {
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
        }
      }
      return { promise: Promise.resolve(), cancel: () => {} }
    },
    destroy: () => {},
  }
}

export async function openPageSource(file: CompareFile): Promise<PageSource> {
  const kind = compareKindOf(file.filename)
  if (kind === 'pdf') return openPdf(file, false)
  if (kind === 'office') return openPdf(file, true)
  if (kind === 'image') return openImage(file)
  throw new NotComparableError()
}
