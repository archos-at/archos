'use client'

import type { CSSProperties, JSX } from 'react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { detailCovers, detailPlan, devicePixelRatioOf, maxCanvasPixels, visiblePart, type Box } from '@/features/knowledge/lib/pdf-raster'
import type { PageSize, PageSource } from './types'
import { pageRaster } from './lib/page-source'
import { tintCanvas, type Rgb } from './lib/tint'
import { FRAME_ATTRIBUTE } from './use-stage-gestures'

const DETAIL_SETTLE_MS = 160

export interface PageCanvasProps {
  source: PageSource
  page: number
  size: PageSize
  scale: number
  ink?: Rgb
  label: string
  className?: string
  style?: CSSProperties
}

const REPAINT_DELAY_MS = 140

export function PageCanvas({
  source,
  page,
  size,
  scale,
  ink,
  label,
  className,
  style,
}: PageCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const paintedRef = useRef<{ source: PageSource; page: number; ink?: Rgb } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || scale <= 0) return
    let cancelled = false
    let handle: { cancel: () => void } | null = null
    const scratch = document.createElement('canvas')
    const paint = (): void => {
      const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
      const render = source.render(page, scratch, { scale, pixelRatio })
      handle = render
      render.promise
        .then(() => {
          if (cancelled || scratch.width === 0) return
          if (ink) tintCanvas(scratch, ink)
          canvas.width = scratch.width
          canvas.height = scratch.height
          canvas.getContext('2d')?.drawImage(scratch, 0, 0)
          paintedRef.current = { source, page, ink }
        })
        .catch(() => {
          // A page that cannot be painted leaves its sheet blank; the other side
        })
        .finally(() => {
          scratch.width = 0
          scratch.height = 0
        })
    }
    const painted = paintedRef.current
    const sameDrawing = painted?.source === source && painted.page === page && painted.ink === ink && canvas.width > 0
    const timer = sameDrawing ? window.setTimeout(paint, REPAINT_DELAY_MS) : null
    if (!sameDrawing) paint()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      handle?.cancel()
    }
  }, [source, page, scale, ink])

  useEffect(() => {
    const host = detailRef.current
    const canvas = canvasRef.current
    if (!host || !canvas || scale <= 0) return
    const frame = canvas.closest<HTMLElement>(`[${FRAME_ATTRIBUTE}]`)
    if (!frame) return
    const width = size.width * scale
    const height = size.height * scale
    let drawn: Box | null = null
    let cancelled = false
    let handle: { cancel: () => void } | null = null
    let timer: number | null = null
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
    const update = (): void => {
      timer = null
      if (cancelled) return
      const box = canvas.getBoundingClientRect()
      const view = frame.getBoundingClientRect()
      const visible = visiblePart(
        { x: box.left, y: box.top, width: box.width, height: box.height },
        { x: view.left, y: view.top, width: frame.clientWidth, height: frame.clientHeight },
      )
      const dpr = devicePixelRatioOf(typeof window === 'undefined' ? 1 : window.devicePixelRatio)
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
      const plan = detailPlan({
        page: { width, height },
        visible,
        base: pageRaster(size, scale, dpr),
        dpr,
        maxPixels: maxCanvasPixels(coarse),
      })
      if (!plan) return drop()
      if (drawn && detailCovers({ drawn, drawnWidth: width, pageWidth: width, visible })) return
      handle?.cancel()
      const { region } = plan
      const next = document.createElement('canvas')
      next.setAttribute('aria-hidden', 'true')
      Object.assign(next.style, {
        position: 'absolute',
        left: `${(region.x / width) * 100}%`,
        top: `${(region.y / height) * 100}%`,
        width: `${(region.width / width) * 100}%`,
        height: `${(region.height / height) * 100}%`,
      })
      const render = source.render(page, next, { scale, pixelRatio: plan.raster.ratio, region })
      handle = render
      render.promise
        .then(() => {
          if (cancelled || next.width === 0) return
          if (ink) tintCanvas(next, ink)
          drop()
          host.appendChild(next)
          drawn = region
        })
        .catch(() => {
          next.width = 0
          next.height = 0
        })
    }
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(update, DETAIL_SETTLE_MS)
    }
    schedule()
    frame.addEventListener('scroll', schedule, { passive: true })
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      frame.removeEventListener('scroll', schedule)
      handle?.cancel()
    }
  }, [source, page, size, scale, ink])

  useEffect(() => {
    const host = detailRef.current
    return () => {
      for (const child of Array.from(host?.children ?? [])) {
        if (child instanceof HTMLCanvasElement) {
          child.width = 0
          child.height = 0
        }
      }
      host?.replaceChildren()
    }
  }, [source, page, ink])

  return (
    <>
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      data-testid="compare-page"
      className={cn('block max-w-none', className)}
      style={{ width: size.width * scale, height: size.height * scale, ...style }}
    />
    {/* Over the page's own box: its parent is positioned at the page's corner in every view. */}
    <div
      ref={detailRef}
      aria-hidden
      data-testid="compare-page-detail"
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: size.width * scale, height: size.height * scale }}
    />
    </>
  )
}
