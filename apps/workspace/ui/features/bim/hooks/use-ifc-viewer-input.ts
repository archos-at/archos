import { useCallback, useEffect, useRef } from 'react'
import type { BimViewerElement } from '../lib/model-index'
import { dragSlopFor, isDoubleTap, keyboardCameraStep, pointerDragged, wheelZoomDelta } from '../lib/viewer-camera'
import { completeMeasurement } from '../lib/viewer-measure'
import { HOVER_BUDGET_MS, KEY_ORBIT_PX, KEY_PAN_PX } from '../components/ifc-viewer-canvas-helpers'
import type { IfcViewerState } from './use-ifc-viewer-state'
import type { IfcViewerFrame } from './use-ifc-viewer-frame'
import type { IfcViewerCamera } from './use-ifc-viewer-camera'
import type { IfcViewerMeasure } from './use-ifc-viewer-measure'

export function useIfcViewerInput(viewer: IfcViewerState & IfcViewerFrame & IfcViewerCamera & IfcViewerMeasure) {
  const {
    anchorRef,
    canvasRef,
    compact,
    cursorRef,
    elementsRef,
    fitModel,
    hiddenPickOption,
    interactingRef,
    isolatedRef,
    measureAt,
    measuringRef,
    onMeasurePendingRef,
    onMeasureRef,
    onSelectRef,
    overlayRef,
    placeMeasurePoint,
    ready,
    rendererRef,
    requestFrame,
    runCameraLoop,
    seedMeasureCursor,
    setDragging,
    setHovering,
    sourceUrl,
  } = viewer
  const dragRef = useRef<{
    x: number
    y: number
    originX: number
    originY: number
    button: number
    moved: boolean
    pointerType: string
  } | null>(null)
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const touchFramedAtRef = useRef(0)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; centreX: number; centreY: number } | null>(null)

  const pinchState = (): { distance: number; centreX: number; centreY: number } | null => {
    const [a, b] = [...pointersRef.current.values()]
    if (!a || !b) return null
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      centreX: (a.x + b.x) / 2,
      centreY: (a.y + b.y) / 2,
    }
  }

  const endPointer = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) {
      pinchRef.current = null
    } else {
      pinchRef.current = pinchState()
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (pointersRef.current.size === 0) {
      interactingRef.current = false
      setDragging(false)
      return
    }
    if (pointersRef.current.size === 1 && dragRef.current === null) {
      const [survivor] = [...pointersRef.current.values()]
      if (survivor) {
        dragRef.current = {
          x: survivor.x,
          y: survivor.y,
          originX: survivor.x,
          originY: survivor.y,
          button: 0,
          moved: true,
          pointerType: 'touch',
        }
      }
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    interactingRef.current = true
    setDragging(true)
    if (pointersRef.current.size >= 2) {
      pinchRef.current = pinchState()
      dragRef.current = null
      return
    }
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
      button: event.button,
      moved: false,
      pointerType: event.pointerType || 'mouse',
    }
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    endPointer(event)
  }

  const hoverAffordableRef = useRef(true)
  const hoverFrameRef = useRef<number | null>(null)

  const testHover = useCallback((clientX: number, clientY: number) => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer?.raycastScene || !canvas || !hoverAffordableRef.current) return
    if (hoverFrameRef.current !== null) return
    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null
      const active = rendererRef.current
      if (!active?.raycastScene) return
      const rect = canvas.getBoundingClientRect()
      const started = performance.now()
      try {
        const hit = active.raycastScene(clientX - rect.left, clientY - rect.top, {
          isolatedIds: isolatedRef.current,
          ...hiddenPickOption(),
        })
        setHovering(hit?.intersection?.expressId !== undefined)
      } catch {
        hoverAffordableRef.current = false
        setHovering(false)
      }
      if (performance.now() - started > HOVER_BUDGET_MS) {
        hoverAffordableRef.current = false
        setHovering(false)
      }
    })
  }, [hiddenPickOption])

  useEffect(() => {
    hoverAffordableRef.current = !compact
    return () => {
      if (hoverFrameRef.current !== null) cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
  }, [compact, sourceUrl])

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current
    if (!renderer) return

    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    const previous = pinchRef.current
    if (previous) {
      const current = pinchState()
      if (!current) return
      pinchRef.current = current
      const rect = event.currentTarget.getBoundingClientRect()
      if (previous.distance > 0 && current.distance > 0) {
        renderer
          .getCamera()
          .zoom(
            Math.log(previous.distance / current.distance) * 1000,
            false,
            current.centreX - rect.left,
            current.centreY - rect.top,
            rect.width,
            rect.height
          )
      }
      renderer.getCamera().pan(current.centreX - previous.centreX, current.centreY - previous.centreY)
      requestFrame()
      return
    }

    const drag = dragRef.current
    if (!drag) {
      if (!ready) return
      if (measuringRef.current) {
        cursorRef.current = measureAt(event.clientX, event.clientY)
        overlayRef.current?.setPending(anchorRef.current, cursorRef.current)
        requestFrame()
        return
      }
      testHover(event.clientX, event.clientY)
      return
    }
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    const wasMoved = drag.moved
    if (
      pointerDragged(
        { x: drag.originX, y: drag.originY },
        { x: event.clientX, y: event.clientY },
        dragSlopFor(drag.pointerType)
      )
    ) {
      drag.moved = true
    }
    if (drag.pointerType !== 'mouse' && !drag.moved) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (drag.pointerType !== 'mouse' && !wasMoved) return
    if (drag.button === 1 || drag.button === 2 || event.shiftKey) {
      renderer.getCamera().pan(dx, dy, true)
    } else {
      renderer.getCamera().orbit(dx, dy, true)
    }
    runCameraLoop()
  }

  const pickAt = useCallback(async (clientX: number, clientY: number): Promise<BimViewerElement | null> => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const hit = await renderer.pick(
      Math.round(clientX - rect.left),
      Math.round(clientY - rect.top),
      { isolatedIds: isolatedRef.current, ...hiddenPickOption() }
    )
    const expressId = hit?.expressId
    if (expressId === undefined) return null
    return elementsRef.current.find((candidate) => candidate.expressId === expressId) ?? null
  }, [hiddenPickOption])

  const handlePointerUp = async (event: React.PointerEvent<HTMLCanvasElement>) => {
    const wasPinching = pinchRef.current !== null
    const drag = dragRef.current
    dragRef.current = null
    endPointer(event)
    if (wasPinching) return
    if (!rendererRef.current || !drag || drag.moved || drag.button !== 0) return

    if (measuringRef.current) {
      placeMeasurePoint(event.clientX, event.clientY)
      return
    }

    if (drag.pointerType !== 'mouse') {
      const tap = { at: performance.now(), x: event.clientX, y: event.clientY }
      const doubled = isDoubleTap(lastTapRef.current, tap)
      lastTapRef.current = doubled ? null : tap
      if (doubled) {
        touchFramedAtRef.current = tap.at
        await frameAt(event.clientX, event.clientY)
        return
      }
    }

    try {
      onSelectRef.current?.(await pickAt(event.clientX, event.clientY))
    } catch {
      onSelectRef.current?.(null)
    }
  }

  const frameAt = async (clientX: number, clientY: number) => {
    const renderer = rendererRef.current
    if (!renderer || !ready) return
    if (measuringRef.current) return
    try {
      const element = await pickAt(clientX, clientY)
      if (!element) {
        fitModel()
        return
      }
      const box = renderer.getScene().getEntityBoundingBox(element.expressId)
      if (!box) return
      onSelectRef.current?.(element)
      const camera = renderer.getCamera()
      runCameraLoop()
      void (camera.frameBounds
        ? camera.frameBounds(box.min, box.max)
        : camera.zoomExtent(box.min, box.max)
      )
        .then(() => requestFrame())
        .catch(() => {})
    } catch {
      // A pick that failed is a double-click that did nothing, which is a
    }
  }

  const handleDoubleClick = async (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (performance.now() - touchFramedAtRef.current < 600) return
    await frameAt(event.clientX, event.clientY)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      const renderer = rendererRef.current
      if (!renderer) return
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      renderer
        .getCamera()
        .zoom(
          wheelZoomDelta(event.deltaY, event.deltaMode, rect.height),
          true,
          event.clientX - rect.left,
          event.clientY - rect.top,
          rect.width,
          rect.height,
          event.ctrlKey
        )
      runCameraLoop()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [runCameraLoop])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current
    if (!renderer || !ready) return
    const step = keyboardCameraStep(event.key)
    if (step === null) {
      if (event.key === 'f' || event.key === 'F' || event.key === 'Home') {
        event.preventDefault()
        fitModel()
      }
      if ((event.key === 'Enter' || event.key === ' ') && measuringRef.current) {
        event.preventDefault()
        const cursor = cursorRef.current ?? seedMeasureCursor()
        if (cursor) {
          const pending = anchorRef.current
          if (!pending) {
            anchorRef.current = cursor
            onMeasurePendingRef.current?.(true)
          } else {
            const measurement = completeMeasurement(pending, cursor)
            if (measurement) {
              anchorRef.current = null
              onMeasurePendingRef.current?.(false)
              onMeasureRef.current?.(measurement)
            }
          }
          overlayRef.current?.setPending(anchorRef.current, cursor)
          requestFrame()
        }
        return
      }
      if (event.key === 'Escape' && measuringRef.current && anchorRef.current) {
        event.preventDefault()
        event.stopPropagation()
        anchorRef.current = null
        onMeasurePendingRef.current?.(false)
        overlayRef.current?.setPending(null, cursorRef.current)
        requestFrame()
      }
      return
    }
    event.preventDefault()
    const camera = renderer.getCamera()
    if (step.kind === 'zoom') {
      const rect = event.currentTarget.getBoundingClientRect()
      camera.zoom(step.amount, true, rect.width / 2, rect.height / 2, rect.width, rect.height)
    } else if (event.shiftKey) {
      camera.pan(step.x * KEY_PAN_PX, step.y * KEY_PAN_PX, true)
    } else {
      camera.orbit(step.x * KEY_ORBIT_PX, step.y * KEY_ORBIT_PX, true)
    }
    runCameraLoop()
  }

  return {
    dragRef,
    lastTapRef,
    touchFramedAtRef,
    pointersRef,
    pinchRef,
    pinchState,
    endPointer,
    handlePointerDown,
    handlePointerCancel,
    handlePointerMove,
    pickAt,
    handlePointerUp,
    frameAt,
    handleDoubleClick,
    hoverAffordableRef,
    hoverFrameRef,
    testHover,
    handleKeyDown,
  }
}
