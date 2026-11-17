import type { PageRegion } from './page-region'
import { maxCanvasPixels, rasterFor, type Box } from './pdf-raster'
import { placeBox, placeClip, placeFileUrl, placePreviewUrl, type PagePlace } from './page-place'
import { documentParameters, loadPdfjs } from './pdfjs-runtime'

export interface PlaceFit {
  width: number
  maxHeight?: number
}

export interface ImageClip {
  url: string
  crop: Box
}

export type DrawnPlace =
  | {
      status: 'drawn'
      width: number
      aspect: number
      mark: PageRegion['box'] | null
      image?: ImageClip
    }
  | { status: 'denied' }
  | { status: 'unavailable' }

const UNAVAILABLE: DrawnPlace = { status: 'unavailable' }
const DENIED: DrawnPlace = { status: 'denied' }

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

const deniedStatus = (status: number | undefined): boolean => status === 401 || status === 403 || status === 404

const fittedWidth = (fit: PlaceFit, aspect: number): number =>
  Math.max(1, Math.round(fit.maxHeight ? Math.min(fit.width, fit.maxHeight * aspect) : fit.width))

function clipFor(
  size: { width: number; height: number },
  place: PagePlace,
  clip: boolean
): { crop: Box; mark: PageRegion['box'] | null } {
  const box = placeBox(place)
  const { crop } = placeClip(size, clip ? box : null)
  if (!box) return { crop, mark: null }
  const [x0, y0, x1, y1] = box
  const left = (x0 * size.width - crop.x) / crop.width
  const top = (y0 * size.height - crop.y) / crop.height
  const right = (x1 * size.width - crop.x) / crop.width
  const bottom = (y1 * size.height - crop.y) / crop.height
  return { crop, mark: [left, top, right, bottom] }
}

async function drawImage(place: PagePlace, fit: PlaceFit, clip: boolean, signal: AbortSignal): Promise<DrawnPlace> {
  const previewUrl = placePreviewUrl(place)
  if (!previewUrl) return UNAVAILABLE
  const response = await fetch(previewUrl, { signal })
  if (deniedStatus(response.status)) return DENIED
  if (!response.ok) return UNAVAILABLE
  const body = (await response.json()) as { url?: unknown; imageUrl?: unknown; contentType?: unknown }
  const url = typeof body.imageUrl === 'string' ? body.imageUrl : typeof body.url === 'string' ? body.url : null
  if (!url || typeof body.contentType !== 'string' || !body.contentType.startsWith('image/')) return UNAVAILABLE

  const natural = await new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = url
  })
  if (!natural || natural.width <= 0 || natural.height <= 0 || signal.aborted) return UNAVAILABLE
  const { crop, mark } = clipFor(natural, place, clip)
  const aspect = crop.width / crop.height
  return {
    status: 'drawn',
    width: fittedWidth(fit, aspect),
    aspect,
    mark,
    image: {
      url,
      crop: {
        x: crop.x / natural.width,
        y: crop.y / natural.height,
        width: crop.width / natural.width,
        height: crop.height / natural.height,
      },
    },
  }
}

export async function drawPlace(options: {
  place: PagePlace
  canvas: HTMLCanvasElement
  fit: PlaceFit
  clip?: boolean
  signal: AbortSignal
}): Promise<DrawnPlace> {
  const { place, canvas, fit, clip = true, signal } = options
  const url = placeFileUrl(place)
  if (!url) return UNAVAILABLE
  let loading: { promise: Promise<unknown>; destroy: () => Promise<void> } | null = null
  try {
    const pdfjs = await loadPdfjs()
    if (signal.aborted) return UNAVAILABLE
    const task = pdfjs.getDocument(documentParameters(url))
    loading = task
    let doc: Awaited<typeof task.promise>
    try {
      doc = await task.promise
    } catch (error) {
      const status = statusOf(error)
      if (status === 415 && place.document.shelf === 'stored') return await drawImage(place, fit, clip, signal)
      return deniedStatus(status) ? DENIED : UNAVAILABLE
    }
    if (signal.aborted || place.page < 1 || place.page > doc.numPages) return UNAVAILABLE
    const page = await doc.getPage(place.page)
    const base = page.getViewport({ scale: 1 })
    const { crop, mark } = clipFor(base, place, clip)
    const aspect = crop.width / crop.height
    const width = fittedWidth(fit, aspect)
    const scale = width / crop.width
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
    const raster = rasterFor({
      width,
      height: crop.height * scale,
      dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
      maxPixels: maxCanvasPixels(coarse),
    })
    const pixels = scale * raster.ratio
    const viewport = page.getViewport({ scale: pixels, offsetX: -crop.x * pixels, offsetY: -crop.y * pixels })
    canvas.width = raster.width
    canvas.height = raster.height
    const render = page.render({ canvas, viewport })
    signal.addEventListener('abort', () => render.cancel(), { once: true })
    await render.promise
    return signal.aborted ? UNAVAILABLE : { status: 'drawn', width, aspect, mark }
  } catch {
    return UNAVAILABLE
  } finally {
    void loading?.destroy()
  }
}
