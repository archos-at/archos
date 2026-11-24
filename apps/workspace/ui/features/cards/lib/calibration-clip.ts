import type { PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import type { CalibrationPoint } from '@/lib/drawing-calibrations/wire'
import { documentParameters, loadPdfjs, maxCanvasPixels, rasterFor } from '@/features/knowledge/page-clip'
import { spanCrop, type ProposedCalibration } from './calibration-proposal'

export type ClipPoint = { x: number; y: number }

export type DrawnClip =
  | {
      status: 'drawn'
      width: number
      aspect: number
      pagePt: PageSizePt
      from: ClipPoint
      to: ClipPoint
    }
  | { status: 'denied' }
  | { status: 'unavailable' }

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

const LEGIBLE_PX_PER_PT = 1.6

const DENIED_STATUSES = new Set([401, 403, 404])

export async function drawCalibrationClip(options: {
  proposed: ProposedCalibration
  canvas: HTMLCanvasElement
  fit: { width: number; maxHeight: number }
  signal: AbortSignal
}): Promise<DrawnClip> {
  const { proposed, canvas, fit, signal } = options
  const { from, to, page: pageNumber } = proposed.calibration
  let loading: { destroy: () => Promise<void> } | null = null
  try {
    const pdfjs = await loadPdfjs()
    if (signal.aborted) return { status: 'unavailable' }
    const task = pdfjs.getDocument(
      documentParameters(`/api/documents/${encodeURIComponent(proposed.documentId)}/file`)
    )
    loading = task
    let doc: Awaited<typeof task.promise>
    try {
      doc = await task.promise
    } catch (error) {
      return { status: DENIED_STATUSES.has(statusOf(error) ?? 0) ? 'denied' : 'unavailable' }
    }
    if (signal.aborted || pageNumber > doc.numPages) return { status: 'unavailable' }
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const crop = spanCrop(base, from, to, fit.width / LEGIBLE_PX_PER_PT)
    const aspect = crop.width / crop.height
    const width = Math.max(1, Math.round(Math.min(fit.width, fit.maxHeight * aspect)))
    const scale = width / crop.width
    const coarse = window.matchMedia?.('(pointer: coarse)').matches === true
    const raster = rasterFor({
      width,
      height: crop.height * scale,
      dpr: window.devicePixelRatio,
      maxPixels: maxCanvasPixels(coarse),
    })
    const pixels = scale * raster.ratio
    const viewport = page.getViewport({
      scale: pixels,
      offsetX: -crop.x * pixels,
      offsetY: -crop.y * pixels,
    })
    canvas.width = raster.width
    canvas.height = raster.height
    const render = page.render({ canvas, viewport })
    signal.addEventListener('abort', () => render.cancel(), { once: true })
    await render.promise
    if (signal.aborted) return { status: 'unavailable' }
    const inClip = (point: CalibrationPoint): ClipPoint => ({
      x: (point.x * base.width - crop.x) / crop.width,
      y: (point.y * base.height - crop.y) / crop.height,
    })
    return {
      status: 'drawn',
      width,
      aspect,
      pagePt: { width: base.width, height: base.height },
      from: inClip(from),
      to: inClip(to),
    }
  } catch {
    return { status: 'unavailable' }
  } finally {
    void loading?.destroy()
  }
}
