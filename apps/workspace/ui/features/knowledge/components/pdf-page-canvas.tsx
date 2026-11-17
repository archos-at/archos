import { useEffect, useRef, useState, type CSSProperties, type FC, type ReactNode } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

import { cn } from '@/lib/utils'

import { readPageTextItems, renderTextLayer, type TextLayerHandle } from '../lib/pdfjs-runtime'
import { pageTextChunks } from '../lib/pdf-text-chunks'
import { canvasMeasure } from '../lib/canvas-measure'
import type { PageRegion } from '../lib/page-region'
import { RegionMarks } from './region-marks'
import { locatePassage, type HighlightRect } from '../lib/passage-highlight'

import { detailCovers, detailPlan, rasterFor, sameRaster, visiblePart, type Box } from '../lib/pdf-raster'

import { PageSheet } from './pdf-viewer-atoms'

import { PRERENDER_MARGIN, PassageHit, RERASTER_DELAY_MS, ViewSignal, canvasBudget, screenRatio } from './pdf-document-view-helpers'

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy
  pageNumber: number
  label: string
  targetWidth: number
  defaultAspect: number | null
  highlight?: string | null
  highlightColor?: string
  marks: HighlightRect[] | null
  searchMarks: Array<{ rects: HighlightRect[]; active: boolean }> | null
  regions: readonly PageRegion[] | null
  overlay?: ReactNode
  fuzzy: boolean
  ping: number
  onPassage: (hit: PassageHit) => void
  onMiss: (page: number) => void
  onBase: (page: number, width: number) => void
  registerRef: (page: number, node: HTMLDivElement | null) => void
  frameRef: { readonly current: HTMLElement | null }
  viewSignal: ViewSignal
  moving: { readonly active: boolean }
}

export const PdfPageCanvas: FC<PdfPageCanvasProps> = ({
  doc,
  pageNumber,
  label,
  targetWidth,
  defaultAspect,
  highlight,
  highlightColor,
  marks,
  searchMarks,
  regions,
  overlay,
  fuzzy,
  ping,
  onPassage,
  onMiss,
  onBase,
  registerRef,
  frameRef,
  viewSignal,
  moving,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const detailHostRef = useRef<HTMLDivElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(false)
  const openedPage = useRef<PDFPageProxy | null>(null)
  const [base, setBase] = useState<{ width: number; height: number } | null>(null)
  const scale = base && targetWidth > 0 ? targetWidth / base.width : 1

  useEffect(() => {
    if (base) onBase(pageNumber, base.width)
  }, [base, pageNumber, onBase])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (entry) setNear(entry.isIntersecting)
      },
      { rootMargin: PRERENDER_MARGIN },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!near || targetWidth <= 0) {
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      const opened = openedPage.current
      openedPage.current = null
      opened?.cleanup()
      return
    }

    let cancelled = false
    let cancelRender: (() => void) | null = null

    const run = async (): Promise<void> => {
      const pdfPage = await doc.getPage(pageNumber)
      if (cancelled) return
      openedPage.current = pdfPage
      const unscaled = pdfPage.getViewport({ scale: 1 })
      setBase((current) =>
        current && current.width === unscaled.width && current.height === unscaled.height
          ? current
          : { width: unscaled.width, height: unscaled.height },
      )
      if (!canvas) return

      const raster = rasterFor({
        width: targetWidth,
        height: (targetWidth * unscaled.height) / unscaled.width,
        dpr: screenRatio(),
        maxPixels: canvasBudget(),
      })
      if (canvas.width > 0 && sameRaster(canvas, raster)) return
      const viewport = pdfPage.getViewport({ scale: (targetWidth / unscaled.width) * raster.ratio })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const task = pdfPage.render({ canvas, viewport })
      cancelRender = () => task.cancel()
      await task.promise.catch(() => {})
    }

    const start = (): void => {
      void run().catch((error: unknown) => {
        if (process.env.NODE_ENV === 'development') {
          console.debug(`[pdf] page ${pageNumber} failed to render`, error)
        }
      })
    }
    const hasBitmap = Boolean(canvas && canvas.width > 0)
    const timer = hasBitmap ? window.setTimeout(start, RERASTER_DELAY_MS) : null
    if (!hasBitmap) start()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      cancelRender?.()
    }
  }, [doc, pageNumber, targetWidth, near])

  useEffect(() => {
    const host = detailHostRef.current
    if (!host) return
    let drawn: { region: Box; pageWidth: number } | null = null
    const drop = (): void => {
      for (const child of Array.from(host.children)) {
        if (child instanceof HTMLCanvasElement) {
          child.width = 0
          child.height = 0
        }
      }
      host.replaceChildren()
      drawn = null
    }
    if (!near || targetWidth <= 0 || !base) {
      drop()
      return
    }
    let cancelled = false
    let task: RenderTask | null = null
    let pending: HTMLCanvasElement | null = null
    const pageHeight = (targetWidth * base.height) / base.width

    const update = (): void => {
      const node = containerRef.current
      const frameNode = frameRef.current
      if (cancelled || !node || !frameNode || moving.active) return
      const pageBox = node.getBoundingClientRect()
      const frameBox = frameNode.getBoundingClientRect()
      const visible = visiblePart(
        { x: pageBox.left, y: pageBox.top, width: pageBox.width, height: pageBox.height },
        { x: frameBox.left, y: frameBox.top, width: frameNode.clientWidth, height: frameNode.clientHeight },
      )
      const dpr = screenRatio()
      const maxPixels = canvasBudget()
      const plan = detailPlan({
        page: { width: targetWidth, height: pageHeight },
        visible,
        base: rasterFor({ width: targetWidth, height: pageHeight, dpr, maxPixels }),
        dpr,
        maxPixels,
      })
      if (!plan) {
        task?.cancel()
        drop()
        return
      }
      if (drawn && detailCovers({ drawn: drawn.region, drawnWidth: drawn.pageWidth, pageWidth: targetWidth, visible })) return
      task?.cancel()
      if (pending) {
        pending.width = 0
        pending.height = 0
      }
      const { region, raster } = plan
      const canvas = document.createElement('canvas')
      pending = canvas
      canvas.width = raster.width
      canvas.height = raster.height
      canvas.setAttribute('aria-hidden', 'true')
      canvas.dataset.testid = 'pdf-page-detail'
      Object.assign(canvas.style, {
        position: 'absolute',
        left: `${(region.x / targetWidth) * 100}%`,
        top: `${(region.y / pageHeight) * 100}%`,
        width: `${(region.width / targetWidth) * 100}%`,
        height: `${(region.height / pageHeight) * 100}%`,
      })
      void doc
        .getPage(pageNumber)
        .then(async (pdfPage) => {
          if (cancelled || pending !== canvas) return
          const viewport = pdfPage.getViewport({
            scale: (targetWidth / base.width) * raster.ratio,
            offsetX: -region.x * raster.ratio,
            offsetY: -region.y * raster.ratio,
          })
          const started = typeof performance === 'undefined' ? 0 : performance.now()
          task = pdfPage.render({ canvas, viewport })
          await task.promise
          if (cancelled || pending !== canvas) return
          pending = null
          drop()
          host.appendChild(canvas)
          drawn = { region, pageWidth: targetWidth }
          if (process.env.NODE_ENV === 'development') {
            const elapsed = typeof performance === 'undefined' ? 0 : performance.now() - started
            console.debug(
              `[pdf] page ${pageNumber} detail ${raster.width}x${raster.height} (${(
                (raster.width * raster.height) /
                1e6
              ).toFixed(1)} MP) in ${Math.round(elapsed)} ms`,
            )
          }
        })
        .catch(() => {
          if (pending === canvas) pending = null
          canvas.width = 0
          canvas.height = 0
        })
    }

    const unsubscribe = viewSignal.subscribe(update)
    return () => {
      cancelled = true
      unsubscribe()
      task?.cancel()
      if (pending) {
        pending.width = 0
        pending.height = 0
      }
    }
  }, [doc, pageNumber, near, targetWidth, base, frameRef, viewSignal, moving])

  useEffect(() => {
    if (!near || !highlight) return
    let cancelled = false

    const run = async (): Promise<void> => {
      const pdfPage = await doc.getPage(pageNumber)
      if (cancelled) return
      const unscaled = pdfPage.getViewport({ scale: 1 })
      const items = await readPageTextItems(pdfPage)
      if (cancelled) return
      const match = locatePassage(pageTextChunks(items, unscaled.transform), highlight, canvasMeasure())
      if (cancelled) return
      if (match)
        onPassage({
          page: pageNumber,
          rects: match.rects,
          fuzzy: match.matcher !== 'exact' && match.matcher !== 'anchored',
        })
      else onMiss(pageNumber)
    }

    void run().catch((error: unknown) => {
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[pdf] page ${pageNumber} passage lookup failed`, error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, near, highlight, onPassage, onMiss])

  useEffect(() => {
    const container = textLayerRef.current
    if (!near || !container) return
    let cancelled = false
    let layer: TextLayerHandle | null = null

    const run = async (): Promise<void> => {
      const pdfPage = await doc.getPage(pageNumber)
      if (cancelled) return
      layer = await renderTextLayer(pdfPage, container)
      if (cancelled) layer.destroy()
    }

    void run().catch((error: unknown) => {
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[pdf] page ${pageNumber} text layer failed`, error)
      }
    })
    return () => {
      cancelled = true
      layer?.destroy()
    }
  }, [doc, pageNumber, near])

  const effectiveAspect = base ? base.height / base.width : defaultAspect
  const height = effectiveAspect && targetWidth ? targetWidth * effectiveAspect : undefined

  return (
    <PageSheet
      ref={(node) => {
        containerRef.current = node
        registerRef(pageNumber, node)
      }}
      data-page={pageNumber}
      role="group"
      aria-label={label}
      style={{ width: targetWidth || undefined, height }}
    >
      <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />
      {/* The sharp part, over the base it sharpens and under the text layer,
          so a selection and the marks still sit on top of it. */}
      <div ref={detailHostRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" />
      {/* The page's text, transparent and positioned over its own glyphs. It
          carries no pixels — its whole job is that a drag selects the sentence,
          Cmd-C copies it, a screen reader reads it and the search finds it,
          which a canvas alone silently refuses. `--total-scale-factor` is the
          zoom: pdf.js writes the runs in page units and multiplies by this, so
          the layer re-scales without being rebuilt. */}
      <div
        ref={textLayerRef}
        data-testid="pdf-text-layer"
        className="pdf-text-layer"
        style={{ ['--total-scale-factor' as string]: scale } as CSSProperties}
      />
      {regions && <RegionMarks regions={regions} color={highlightColor} ping={ping} />}
      {overlay && <div className="pointer-events-none absolute inset-0 z-20">{overlay}</div>}
      {searchMarks?.flatMap((entry, entryIndex) =>
        entry.rects.map((rect, index) => (
          <span
            key={`search-${entryIndex}-${index}`}
            data-testid="search-mark"
            data-active={entry.active || undefined}
            aria-hidden
            className={cn('pdf-search-hit pointer-events-none absolute', entry.active && 'pdf-search-hit--active')}
            style={{
              left: rect.x * scale,
              top: rect.y * scale,
              width: rect.width * scale,
              height: rect.height * scale,
            }}
          />
        )),
      )}
      {marks?.map((rect, index) => (
        <span
          key={`${ping}-${index}`}
          data-testid="passage-mark"
          data-fuzzy={fuzzy || undefined}
          aria-hidden
          className={cn(
            'passage-highlight animate-passage-ping motion-reduce:animate-none pointer-events-none absolute',
            fuzzy && 'passage-highlight--fuzzy'
          )}
          style={
            {
              left: rect.x * scale,
              top: rect.y * scale,
              width: rect.width * scale,
              height: rect.height * scale,
              ...(highlightColor ? { ['--passage-tint' as string]: highlightColor } : {}),
            } as CSSProperties
          }
        />
      ))}
    </PageSheet>
  )
}
