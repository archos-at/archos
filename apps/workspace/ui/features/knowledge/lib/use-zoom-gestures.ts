'use client'

import type { RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ContentTransform } from './content-transform'
import { anchoredTransform, clampZoom, doubleTapZoom, rubberBandZoom, twoFingerTapZoom } from './pdf-zoom'
import { classifyTap, type TapRecord } from './tap-gestures'

const WHEEL_SENSITIVITY = 0.002
const MAX_WHEEL_DELTA = 100
const WHEEL_COMMIT_MS = 160

interface SafariGestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

export interface ZoomCommit {
  target: number
  shown: number
  clientX: number
  clientY: number
  contentX: number
  contentY: number
}

const CONTROL_SELECTOR = 'button, a, input, textarea, select, label, [role="slider"], [data-zoom-tap="off"]'

const onControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(CONTROL_SELECTOR) !== null

interface Held {
  zoom: number
  point: { x: number; y: number }
  origin: { x: number; y: number }
  scroll: { left: number; top: number }
}

export function useZoomGestures(
  frameRef: RefObject<HTMLElement | null>,
  options: {
    enabled: boolean
    contentRef: RefObject<HTMLElement | null>
    transform: ContentTransform
    zoom: number
    maxZoom: number
    onCommit: (commit: ZoomCommit) => void
  },
): void {
  const { enabled, contentRef, transform, zoom, maxZoom, onCommit } = options
  const zoomRef = useRef(zoom)
  const maxRef = useRef(maxZoom)
  const onCommitRef = useRef(onCommit)

  useLayoutEffect(() => {
    zoomRef.current = zoom
    maxRef.current = maxZoom
    onCommitRef.current = onCommit
  }, [zoom, maxZoom, onCommit])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !enabled) return

    const hold = (clientX: number, clientY: number): Held | null => {
      const content = contentRef.current
      if (!content) return null
      transform.finish()
      const rect = content.getBoundingClientRect()
      return {
        zoom: zoomRef.current,
        point: { x: clientX - rect.left, y: clientY - rect.top },
        origin: { x: rect.left, y: rect.top },
        scroll: { left: frame.scrollLeft, top: frame.scrollTop },
      }
    }

    const show = (held: Held, shown: number, clientX: number, clientY: number): void => {
      transform.preview(
        anchoredTransform({
          scale: shown / held.zoom,
          point: held.point,
          origin: {
            x: held.origin.x - (frame.scrollLeft - held.scroll.left),
            y: held.origin.y - (frame.scrollTop - held.scroll.top),
          },
          at: { x: clientX, y: clientY },
        }),
      )
    }

    const commit = (held: Held, target: number, shown: number, clientX: number, clientY: number): void => {
      onCommitRef.current({
        target: clampZoom(target, maxRef.current),
        shown,
        clientX,
        clientY,
        contentX: held.point.x,
        contentY: held.point.y,
      })
    }

    let pinch: (Held & { distance: number; last: { raw: number; x: number; y: number } | null }) | null = null
    let press: TapRecord | null = null
    let lastTap: TapRecord | null = null

    const midpoint = (touches: TouchList): { x: number; y: number; distance: number } => {
      const a = touches[0]
      const b = touches[1]
      if (!a || !b) return { x: a?.clientX ?? 0, y: a?.clientY ?? 0, distance: 0 }
      return {
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      }
    }

    const onPinchMove = (event: TouchEvent): void => {
      if (!pinch || event.touches.length < 2 || pinch.distance <= 0) return
      if (event.cancelable) event.preventDefault()
      const now = midpoint(event.touches)
      const raw = (pinch.zoom * now.distance) / pinch.distance
      pinch.last = { raw, x: now.x, y: now.y }
      show(pinch, rubberBandZoom(raw, maxRef.current), now.x, now.y)
      if (press) press.moved = true
    }

    const endPinch = (): void => {
      if (!pinch) return
      frame.removeEventListener('touchmove', onPinchMove)
      const ended = pinch
      pinch = null
      if (!ended.last) {
        transform.release()
        return
      }
      const { raw, x, y } = ended.last
      commit(ended, raw, rubberBandZoom(raw, maxRef.current), x, y)
    }

    const onTouchStart = (event: TouchEvent): void => {
      const count = event.touches.length
      if (count === 1) {
        const touch = event.touches[0]
        press =
          touch && !onControl(event.target)
            ? { time: event.timeStamp, x: touch.clientX, y: touch.clientY, fingers: 1, moved: false }
            : null
        return
      }
      if (count === 2 && !pinch) {
        const now = midpoint(event.touches)
        const held = hold(now.x, now.y)
        if (!held) return
        pinch = { ...held, distance: now.distance, last: null }
        if (press) {
          press.fingers = 2
          press.x = now.x
          press.y = now.y
        }
        frame.addEventListener('touchmove', onPinchMove, { passive: false })
        return
      }
      press = null
    }

    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0]
      if (!press || !touch || press.fingers !== 1) return
      if (Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) press.moved = true
    }

    const onTouchEnd = (event: TouchEvent): void => {
      if (pinch && event.touches.length < 2) endPinch()
      if (event.touches.length > 0 || !press) return
      const ended = { ...press }
      press = null
      const tap = classifyTap(ended, lastTap, event.timeStamp)
      lastTap = tap.kind === 'single' ? { ...ended, time: event.timeStamp } : null
      if (tap.kind !== 'double' && tap.kind !== 'two-finger') return
      const held = hold(ended.x, ended.y)
      if (!held) return
      const target = tap.kind === 'double' ? doubleTapZoom(held.zoom, maxRef.current) : twoFingerTapZoom(held.zoom, maxRef.current)
      if (Math.abs(target - held.zoom) < 1e-4) return
      if (event.cancelable) event.preventDefault()
      commit(held, target, held.zoom, ended.x, ended.y)
    }

    const onTouchCancel = (): void => {
      endPinch()
      press = null
    }

    let wheel: (Held & { raw: number; at: { x: number; y: number } }) | null = null
    let wheelTimer: number | null = null
    const endWheel = (): void => {
      wheelTimer = null
      const ended = wheel
      wheel = null
      if (!ended) return
      const shown = clampZoom(ended.raw, maxRef.current)
      commit(ended, shown, shown, ended.at.x, ended.at.y)
    }
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      if (!wheel) {
        const held = hold(event.clientX, event.clientY)
        if (!held) return
        wheel = { ...held, raw: held.zoom, at: { x: event.clientX, y: event.clientY } }
      }
      const delta = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, event.deltaY))
      wheel.raw = clampZoom(wheel.raw * Math.exp(-delta * WHEEL_SENSITIVITY), maxRef.current)
      show(wheel, wheel.raw, wheel.at.x, wheel.at.y)
      if (wheelTimer !== null) window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(endWheel, WHEEL_COMMIT_MS)
    }

    let trackpad: (Held & { raw: number; at: { x: number; y: number } }) | null = null
    let fingersDown = 0
    const countFingers = (event: TouchEvent): void => {
      fingersDown = event.touches.length
    }
    const onGestureStart = (event: Event): void => {
      event.preventDefault()
      if (fingersDown > 0) return
      const gesture = event as SafariGestureEvent
      const held = hold(gesture.clientX, gesture.clientY)
      if (held) trackpad = { ...held, raw: held.zoom, at: { x: gesture.clientX, y: gesture.clientY } }
    }
    const onGestureChange = (event: Event): void => {
      event.preventDefault()
      if (!trackpad) return
      const gesture = event as SafariGestureEvent
      trackpad.raw = trackpad.zoom * gesture.scale
      show(trackpad, rubberBandZoom(trackpad.raw, maxRef.current), trackpad.at.x, trackpad.at.y)
    }
    const onGestureEnd = (event: Event): void => {
      event.preventDefault()
      const ended = trackpad
      trackpad = null
      if (!ended) return
      commit(ended, ended.raw, rubberBandZoom(ended.raw, maxRef.current), ended.at.x, ended.at.y)
    }

    frame.addEventListener('wheel', onWheel, { passive: false })
    frame.addEventListener('touchstart', onTouchStart, { passive: true })
    frame.addEventListener('touchstart', countFingers, { passive: true })
    frame.addEventListener('touchmove', onTouchMove, { passive: true })
    frame.addEventListener('touchend', onTouchEnd, { passive: false })
    frame.addEventListener('touchend', countFingers, { passive: true })
    frame.addEventListener('touchcancel', onTouchCancel, { passive: true })
    frame.addEventListener('touchcancel', countFingers, { passive: true })
    frame.addEventListener('gesturestart', onGestureStart)
    frame.addEventListener('gesturechange', onGestureChange)
    frame.addEventListener('gestureend', onGestureEnd)
    return () => {
      if (wheelTimer !== null) window.clearTimeout(wheelTimer)
      frame.removeEventListener('wheel', onWheel)
      frame.removeEventListener('touchstart', onTouchStart)
      frame.removeEventListener('touchstart', countFingers)
      frame.removeEventListener('touchmove', onTouchMove)
      frame.removeEventListener('touchmove', onPinchMove)
      frame.removeEventListener('touchend', onTouchEnd)
      frame.removeEventListener('touchend', countFingers)
      frame.removeEventListener('touchcancel', onTouchCancel)
      frame.removeEventListener('touchcancel', countFingers)
      frame.removeEventListener('gesturestart', onGestureStart)
      frame.removeEventListener('gesturechange', onGestureChange)
      frame.removeEventListener('gestureend', onGestureEnd)
      transform.release()
    }
  }, [frameRef, contentRef, transform, enabled])
}
