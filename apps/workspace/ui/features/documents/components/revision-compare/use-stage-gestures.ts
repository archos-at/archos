'use client'

import type { RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { clampZoom } from './lib/pages'

export const FRAME_ATTRIBUTE = 'data-compare-frame'

interface Anchor {
  frame: HTMLElement
  x: number
  y: number
  contentX: number
  contentY: number
  ratio: number
}

interface Pan {
  frame: HTMLElement
  pointerId: number
  x: number
  y: number
  left: number
  top: number
}

const WHEEL_SENSITIVITY = 0.002
const MAX_WHEEL_DELTA = 100

const frameOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>(`[${FRAME_ATTRIBUTE}]`) : null

const onControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('button, a, input, [role="slider"]') !== null

const overflows = (frame: HTMLElement): boolean =>
  frame.scrollWidth > frame.clientWidth || frame.scrollHeight > frame.clientHeight

export function useStageGestures(
  stageRef: RefObject<HTMLElement | null>,
  options: { enabled: boolean; zoom: number; scale: number; onZoom: (zoom: number) => void },
): void {
  const { enabled, zoom, scale, onZoom } = options
  const zoomRef = useRef(zoom)
  const onZoomRef = useRef(onZoom)
  const anchor = useRef<Anchor | null>(null)

  useLayoutEffect(() => {
    zoomRef.current = zoom
    onZoomRef.current = onZoom
  }, [zoom, onZoom])

  useLayoutEffect(() => {
    const pending = anchor.current
    if (!pending) return
    anchor.current = null
    pending.frame.scrollLeft = pending.contentX * pending.ratio - pending.x
    pending.frame.scrollTop = pending.contentY * pending.ratio - pending.y
  }, [scale])

  useEffect(() => {
    const node = stageRef.current
    if (!node || !enabled) return

    const zoomTo = (target: number, clientX: number, clientY: number, frame: HTMLElement | null): void => {
      const drawn = zoomRef.current
      const next = clampZoom(target)
      if (Math.abs(next - drawn) < 1e-4) return
      if (frame) {
        const rect = frame.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top
        anchor.current = {
          frame,
          x,
          y,
          contentX: frame.scrollLeft + x,
          contentY: frame.scrollTop + y,
          ratio: next / drawn,
        }
      }
      zoomRef.current = next
      onZoomRef.current(next)
    }

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const delta = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, event.deltaY))
      zoomTo(zoomRef.current * Math.exp(-delta * WHEEL_SENSITIVITY), event.clientX, event.clientY, frameOf(event.target))
    }

    const touches = new Map<number, { x: number; y: number }>()
    let pinch: { distance: number; zoom: number } | null = null
    let pan: Pan | null = null

    const spread = (): { distance: number; x: number; y: number } => {
      const [a, b] = [...touches.values()]
      if (!a || !b) return { distance: 0, x: 0, y: 0 }
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touches.size === 2) pinch = { distance: spread().distance, zoom: zoomRef.current }
        return
      }
      if (event.pointerType !== 'mouse' || event.button !== 0 || onControl(event.target)) return
      const frame = frameOf(event.target)
      if (!frame || !overflows(frame)) return
      pan = {
        frame,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: frame.scrollLeft,
        top: frame.scrollTop,
      }
      frame.dataset.panning = 'true'
      event.preventDefault()
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (!pinch || touches.size !== 2 || pinch.distance <= 0) return
        const now = spread()
        zoomTo((pinch.zoom * now.distance) / pinch.distance, now.x, now.y, frameOf(event.target))
        return
      }
      if (!pan || event.pointerId !== pan.pointerId) return
      pan.frame.scrollLeft = pan.left - (event.clientX - pan.x)
      pan.frame.scrollTop = pan.top - (event.clientY - pan.y)
    }

    const onPointerEnd = (event: PointerEvent): void => {
      touches.delete(event.pointerId)
      if (touches.size < 2) pinch = null
      if (pan && event.pointerId === pan.pointerId) {
        delete pan.frame.dataset.panning
        pan = null
      }
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    node.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    return () => {
      node.removeEventListener('wheel', onWheel)
      node.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [stageRef, enabled])
}
