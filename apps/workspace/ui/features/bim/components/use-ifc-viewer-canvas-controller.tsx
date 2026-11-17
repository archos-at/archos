import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { RenderOptions } from '@ifc-lite/renderer'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'

import { capturePosthog } from '@/lib/analytics/posthog'
import type { BimViewerElement, Rgba } from '../lib/model-index'
import { MeasureOverlay } from '../lib/measure-overlay'
import { completeMeasurement, MEASURE_SNAP_OPTIONS, type MeasureAnchor, type MeasureSnapKind, type Measurement } from '../lib/viewer-measure'
import { boundsCentre, downloadWithProgress, dragSlopFor, isDoubleTap, keyboardCameraStep, pointerDragged, rendererPreset, rendererSectionPlane, wheelZoomDelta, type BimCameraView, type BimSection } from '../lib/viewer-camera'
import { unwrapModelSource } from '../lib/model-source'
import { captureFrameOptions, interactiveFrameOptions } from '../lib/viewer-performance'
import { observeViewerTheme, readViewerTheme, VIEWER_CLEAR_COLOR, viewerEnhancement, viewerEnhancementCompact, viewerEnvironment } from '../lib/viewer-scene'

import { RendererLike, HOVER_BUDGET_MS, KEY_ORBIT_PX, KEY_PAN_PX, modelBoundsMetres } from './ifc-viewer-canvas-helpers'

export interface IfcViewerCanvasProps {
  sourceUrl: string
  elements: readonly BimViewerElement[]
  colorOverrides?: Map<number, Rgba>
  isolatedExpressIds?: Set<number> | null
  hiddenExpressIds?: ReadonlySet<number> | null
  selectedExpressId?: number | null
  xrayKeepIds?: Set<number> | null
  onSelect?: (element: BimViewerElement | null) => void
  onStatus?: (status: IfcViewerStatus) => void
  view?: BimCameraView
  orthographic?: boolean
  section?: BimSection | null
  onBounds?: (bounds: { minMetres: number; maxMetres: number } | null) => void
  viewNonce?: number
  fitNonce?: number
  zoomToSelection?: boolean
  compact?: boolean
  measuring?: boolean
  measurements?: readonly Measurement[]
  onMeasure?: (measurement: Measurement) => void
  onMeasurePending?: (pending: boolean) => void
  captureNonce?: number
  onCapture?: (dataUrl: string | null) => void
  className?: string
}

export interface IfcViewerStatus {
  phase: 'idle' | 'downloading' | 'parsing' | 'ready' | 'error'
  percent: number | null
  meshCount: number
  message?: string
  bytes?: { loaded: number; total: number }
}

export function useIfcViewerCanvasController(props: IfcViewerCanvasProps) {
  const {
  sourceUrl,
  elements,
  colorOverrides,
  isolatedExpressIds = null,
  hiddenExpressIds = null,
  selectedExpressId = null,
  xrayKeepIds = null,
  onSelect,
  onStatus,
  view = 'iso',
  orthographic = false,
  section = null,
  onBounds,
  viewNonce = 0,
  fitNonce = 0,
  zoomToSelection = false,
  compact = false,
  measuring = false,
  measurements,
  onMeasure,
  onMeasurePending,
  captureNonce = 0,
  onCapture,
  className,
  } = props
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const keysId = useId()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlaySvgRef = useRef<SVGSVGElement | null>(null)
  const overlayLabelsRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<RendererLike | null>(null)
  const geometryRef = useRef<{ dispose(): void } | null>(null)
  const [ready, setReady] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [dragging, setDragging] = useState(false)

  const overridesRef = useRef(colorOverrides)
  const isolatedRef = useRef(isolatedExpressIds)
  const hiddenRef = useRef(hiddenExpressIds)
  const selectedRef = useRef(selectedExpressId)
  const xrayRef = useRef(xrayKeepIds)
  const sectionRef = useRef(section)
  const compactRef = useRef(compact)
  sectionRef.current = section
  overridesRef.current = colorOverrides
  isolatedRef.current = isolatedExpressIds
  hiddenRef.current = hiddenExpressIds
  selectedRef.current = selectedExpressId
  xrayRef.current = xrayKeepIds
  compactRef.current = compact

  const elementsRef = useRef(elements)
  elementsRef.current = elements

  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onBoundsRef = useRef(onBounds)
  onBoundsRef.current = onBounds
  const onMeasureRef = useRef(onMeasure)
  onMeasureRef.current = onMeasure
  const onMeasurePendingRef = useRef(onMeasurePending)
  onMeasurePendingRef.current = onMeasurePending
  const measuringRef = useRef(measuring)
  measuringRef.current = measuring
  const onCaptureRef = useRef(onCapture)
  onCaptureRef.current = onCapture

  const overlayRef = useRef<MeasureOverlay | null>(null)
  const anchorRef = useRef<MeasureAnchor | null>(null)
  const cursorRef = useRef<MeasureAnchor | null>(null)

  const themeRef = useRef<'light' | 'dark'>('light')

  const interactingRef = useRef(false)
  const streamingRef = useRef(true)

  const hiddenPickOption = useCallback(
    (): { hiddenIds?: Set<number> } =>
      hiddenRef.current && hiddenRef.current.size > 0
        ? { hiddenIds: new Set(hiddenRef.current) }
        : {},
    []
  )

  const drawOverlay = useCallback((renderer: RendererLike) => {
    const overlay = overlayRef.current
    const canvas = canvasRef.current
    if (!overlay || !canvas) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    try {
      const camera = renderer.getCamera()
      overlay.update((point) => camera.projectToScreen(point, width, height))
    } catch {
      // A camera mid-teardown is a frame without an overlay, not a crash.
    }
  }, [])

  const frameOptions = useCallback((): RenderOptions => {
    const renderer = rendererRef.current
    const theme = themeRef.current
    return {
      isolatedIds: isolatedRef.current,
      ...(hiddenRef.current && hiddenRef.current.size > 0
        ? { hiddenIds: new Set(hiddenRef.current) }
        : {}),
      selectedId: selectedRef.current,
      ghostExceptIds: xrayRef.current && xrayRef.current.size > 0 ? xrayRef.current : null,
      ...(xrayRef.current && xrayRef.current.size > 0
        ? { selectedIds: xrayRef.current }
        : {}),
      ghostAlpha: 0.1,
      clearColor: VIEWER_CLEAR_COLOR[theme],
      environment: viewerEnvironment(theme),
      visualEnhancement: compactRef.current ? viewerEnhancementCompact() : viewerEnhancement(),
      sectionPlane: sectionRef.current
        ? rendererSectionPlane(sectionRef.current, modelBoundsMetres(renderer))
        : undefined,
    }
  }, [])

  const drawFrame = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    try {
      renderer.render({
        ...frameOptions(),
        isStreaming: streamingRef.current,
        isInteracting: interactingRef.current,
        ...interactiveFrameOptions(),
      })
    } catch {
      // A lost device makes render() a no-op upstream; anything else here is
    }
    drawOverlay(renderer)
  }, [drawOverlay, frameOptions])

  const frameRef = useRef<number | null>(null)
  const requestFrame = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      drawFrame()
    })
  }, [drawFrame])

  useEffect(
    () =>
      observeViewerTheme((theme) => {
        themeRef.current = theme
        requestFrame()
      }),
    [requestFrame]
  )

  const cameraLoopRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const runCameraLoop = useCallback(() => {
    if (cameraLoopRef.current !== null) return
    lastFrameRef.current = performance.now()
    const step = (now: number) => {
      const deltaSeconds = Math.min((now - lastFrameRef.current) / 1000, 0.1)
      lastFrameRef.current = now
      const renderer = rendererRef.current
      if (!renderer) {
        cameraLoopRef.current = null
        return
      }
      let moving = false
      try {
        moving = renderer.getCamera().update(deltaSeconds)
      } catch {
        moving = false
      }
      drawFrame()
      cameraLoopRef.current = moving ? requestAnimationFrame(step) : null
    }
    cameraLoopRef.current = requestAnimationFrame(step)
  }, [drawFrame])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const canvas = canvasRef.current
    if (!canvas) return

    themeRef.current = readViewerTheme()
    streamingRef.current = true

    const report = (status: IfcViewerStatus) => {
      if (!cancelled) onStatusRef.current?.(status)
    }

    const run = async () => {
      const startedAt = performance.now()
      report({ phase: 'downloading', percent: 0, meshCount: 0 })
      try {
        const response = await fetch(sourceUrl, { signal: controller.signal })
        if (!response.ok) throw new Error(`model download failed (${response.status})`)
        const downloaded = await downloadWithProgress(response, (percent, bytes) => {
          if (!cancelled) report({ phase: 'downloading', percent, meshCount: 0, bytes })
        })
        if (cancelled) return
        const buffer = await unwrapModelSource(downloaded)
        if (cancelled) return

        report({ phase: 'parsing', percent: null, meshCount: 0 })
        const [{ GeometryProcessor }, { Renderer }] = await Promise.all([
          import('@ifc-lite/geometry'),
          import('@ifc-lite/renderer'),
        ])
        if (cancelled) return

        const geometry = new GeometryProcessor()
        geometryRef.current = geometry
        const renderer: RendererLike = new Renderer(canvas)
        rendererRef.current = renderer
        try {
          await Promise.all([geometry.init(), renderer.init()])
        } catch (error) {
          renderer.destroy()
          if (rendererRef.current === renderer) rendererRef.current = null
          throw error
        }
        if (cancelled) {
          renderer.destroy()
          if (rendererRef.current === renderer) rendererRef.current = null
          return
        }

        renderer.getScene().setLodBuildsEnabled(true)
        try {
          await renderer.enableQuantizedBatches()
        } catch {
          // A probe that throws is a renderer that stays on f32 vertices.
        }
        if (cancelled) {
          renderer.destroy()
          if (rendererRef.current === renderer) rendererRef.current = null
          return
        }

        renderer.onDeviceLost?.((info) => {
          report({ phase: 'error', percent: null, meshCount: 0, message: info.message })
        })

        let meshCount = 0
        for await (const event of geometry.processAdaptive(buffer)) {
          if (cancelled) break
          if (event.type !== 'batch') continue
          renderer.addMeshes(event.meshes, true)
          meshCount += event.meshes.length
          report({ phase: 'parsing', percent: null, meshCount })
          requestFrame()
        }
        if (cancelled) return

        streamingRef.current = false

        const device = renderer.getGPUDevice?.()
        const pipeline = renderer.getPipeline?.()
        if (device && pipeline) {
          try {
            await renderer.getScene().finalizeStreamingAsync?.(device, pipeline)
          } catch {
            // Fragments render correctly, they are just never merged. A
          }
          if (cancelled) return
        }

        const bounds = renderer.getModelBounds()
        if (bounds) renderer.getCamera().setSceneBounds?.(bounds)
        renderer.fitToView()
        fittedOnLoadRef.current = true
        setReady(true)
        report({ phase: 'ready', percent: 100, meshCount })
        if (!cancelled) {
          capturePosthog('ifc_model_opened', {
            element_count: elementsRef.current.length,
            load_ms: Math.round(performance.now() - startedAt),
          })
        }
        requestFrame()
      } catch (error) {
        if (controller.signal.aborted) return
        report({
          phase: 'error',
          percent: null,
          meshCount: 0,
          message: error instanceof Error ? error.message : 'unknown error',
        })
      }
    }

    void run()

    return () => {
      cancelled = true
      controller.abort()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      if (cameraLoopRef.current !== null) cancelAnimationFrame(cameraLoopRef.current)
      cameraLoopRef.current = null
      rendererRef.current?.destroy()
      rendererRef.current = null
      geometryRef.current?.dispose()
      geometryRef.current = null
      setReady(false)
      setHovering(false)
    }
  }, [sourceUrl, requestFrame])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !ready) return
    const device = renderer.getGPUDevice()
    const pipeline = renderer.getPipeline()
    if (!device || !pipeline) return
    if (colorOverrides && colorOverrides.size > 0) {
      renderer.getScene().setColorOverrides(colorOverrides, device, pipeline)
    } else {
      renderer.getScene().clearColorOverrides()
    }
    requestFrame()
  }, [colorOverrides, ready, requestFrame])

  useEffect(() => {
    if (ready) requestFrame()
  }, [isolatedExpressIds, hiddenExpressIds, selectedExpressId, xrayKeepIds, ready, requestFrame])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(entry.contentRect.width * ratio))
      const height = Math.max(1, Math.round(entry.contentRect.height * ratio))
      canvas.width = width
      canvas.height = height
      const renderer = rendererRef.current
      if (renderer) {
        renderer.resize(width, height)
        renderer.getCamera().setAspect(width / height)
        requestFrame()
      }
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [requestFrame])

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

  const fitModel = useCallback(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    const bounds = renderer.getModelBounds()
    if (bounds && renderer.getCamera().fitBoundsAdaptive) {
      renderer.getCamera().fitBoundsAdaptive?.(bounds, { animate: true })
    } else {
      renderer.fitToView()
    }
    runCameraLoop()
  }, [runCameraLoop])

  const fittedRef = useRef(fitNonce)
  useEffect(() => {
    if (!ready || fitNonce === fittedRef.current) return
    fittedRef.current = fitNonce
    fitModel()
  }, [fitNonce, ready, fitModel])

  const capturedRef = useRef(captureNonce)
  useEffect(() => {
    if (!ready || captureNonce === capturedRef.current) return
    capturedRef.current = captureNonce
    const renderer = rendererRef.current
    if (!renderer) return
    let cancelled = false
    const run = async () => {
      try {
        renderer.render({
          ...frameOptions(),
          ...captureFrameOptions(),
        })
        const png = await renderer.captureScreenshot()
        if (!cancelled) onCaptureRef.current?.(png)
      } catch {
        if (!cancelled) onCaptureRef.current?.(null)
      }
      if (!cancelled) requestFrame()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [captureNonce, ready, requestFrame, frameOptions])

  useEffect(() => {
    if (!ready || !zoomToSelection || selectedExpressId === null) return
    const renderer = rendererRef.current
    if (!renderer) return
    const box = renderer.getScene().getEntityBoundingBox(selectedExpressId)
    if (!box) return
    const camera = renderer.getCamera()
    runCameraLoop()
    const framed = camera.frameBounds
      ? camera.frameBounds(box.min, box.max)
      : camera.zoomExtent(box.min, box.max)
    void framed.then(() => requestFrame()).catch(() => {
      // A camera that refuses the move leaves the view where it was, which
    })
  }, [selectedExpressId, zoomToSelection, ready, requestFrame, runCameraLoop])

  useEffect(() => {
    if (!ready) return
    const renderer = rendererRef.current
    if (!renderer) return
    const camera = renderer.getCamera()
    if (selectedExpressId === null) {
      camera.setOrbitCenter(null)
      return
    }
    const box = renderer.getScene().getEntityBoundingBox(selectedExpressId)
    if (!box) {
      camera.setOrbitCenter(null)
      return
    }
    camera.setOrbitCenter(boundsCentre(box))
  }, [selectedExpressId, ready])

  useEffect(() => {
    if (!ready) {
      onBoundsRef.current?.(null)
      return
    }
    onBoundsRef.current?.(modelBoundsMetres(rendererRef.current))
  }, [ready])

  const fittedOnLoadRef = useRef(false)

  useEffect(() => {
    if (!ready) return
    const renderer = rendererRef.current
    if (!renderer) return
    const preset = rendererPreset(view)
    if (preset === null) {
      if (fittedOnLoadRef.current) {
        fittedOnLoadRef.current = false
        return
      }
      fitModel()
    } else {
      fittedOnLoadRef.current = false
      renderer.getCamera().setPresetView(preset, renderer.getModelBounds() ?? undefined)
      runCameraLoop()
    }
  }, [view, viewNonce, ready, runCameraLoop, fitModel])

  useEffect(() => {
    if (!ready) return
    rendererRef.current?.getCamera().setProjectionMode(orthographic ? 'orthographic' : 'perspective')
    requestFrame()
  }, [orthographic, ready, requestFrame])

  useEffect(() => {
    if (ready) requestFrame()
  }, [section, ready, requestFrame])

  useEffect(() => {
    const svg = overlaySvgRef.current
    const labels = overlayLabelsRef.current
    if (!svg || !labels) return
    const overlay = new MeasureOverlay(svg, labels, {
      horizontal: t('viewer.measure.horizontal'),
      vertical: t('viewer.measure.vertical'),
      locale,
    })
    overlayRef.current = overlay
    return () => {
      overlay.destroy()
      overlayRef.current = null
    }
  }, [t, locale])

  useEffect(() => {
    overlayRef.current?.setMeasurements(measurements ?? [])
    requestFrame()
  }, [measurements, requestFrame])

  const measureAt = useCallback((clientX: number, clientY: number): MeasureAnchor | null => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer?.raycastScene || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    try {
      const hit = renderer.raycastScene(clientX - rect.left, clientY - rect.top, {
        isolatedIds: isolatedRef.current,
        ...hiddenPickOption(),
        snapOptions: MEASURE_SNAP_OPTIONS,
      })
      if (!hit) return null
      const snapped = hit.snap
      return snapped
        ? { point: snapped.position, snap: snapped.type as MeasureSnapKind }
        : { point: hit.intersection.point, snap: 'none' }
    } catch {
      return null
    }
  }, [hiddenPickOption])

  const seedMeasureCursor = useCallback((): MeasureAnchor | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const seeded = measureAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (seeded) cursorRef.current = seeded
    return seeded
  }, [measureAt])

  useEffect(() => {
    if (!measuring) {
      anchorRef.current = null
      cursorRef.current = null
      overlayRef.current?.setPending(null, null)
      onMeasurePendingRef.current?.(false)
      requestFrame()
      return
    }
    if (cursorRef.current) return
    const seeded = seedMeasureCursor()
    if (!seeded) return
    overlayRef.current?.setPending(anchorRef.current, seeded)
    requestFrame()
  }, [measuring, requestFrame, seedMeasureCursor])

  const placeMeasurePoint = useCallback(
    (clientX: number, clientY: number) => {
      const anchor = measureAt(clientX, clientY)
      if (!anchor) return
      const pending = anchorRef.current
      if (!pending) {
        anchorRef.current = anchor
        onMeasurePendingRef.current?.(true)
      } else {
        const measurement = completeMeasurement(pending, anchor)
        if (measurement) {
          anchorRef.current = null
          onMeasurePendingRef.current?.(false)
          onMeasureRef.current?.(measurement)
        }
      }
      overlayRef.current?.setPending(anchorRef.current, cursorRef.current)
      requestFrame()
    },
    [measureAt, requestFrame]
  )

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
    anchorRef,
    cameraLoopRef,
    canvasRef,
    captureNonce,
    capturedRef,
    className,
    colorOverrides,
    compact,
    compactRef,
    cursorRef,
    dragRef,
    dragging,
    drawFrame,
    drawOverlay,
    elements,
    elementsRef,
    endPointer,
    fitModel,
    fitNonce,
    fittedOnLoadRef,
    fittedRef,
    frameAt,
    frameOptions,
    frameRef,
    geometryRef,
    handleDoubleClick,
    handleKeyDown,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    hiddenExpressIds,
    hiddenPickOption,
    hiddenRef,
    hoverAffordableRef,
    hoverFrameRef,
    hovering,
    interactingRef,
    isolatedExpressIds,
    isolatedRef,
    keysId,
    lastFrameRef,
    lastTapRef,
    locale,
    measureAt,
    measurements,
    measuring,
    measuringRef,
    onBounds,
    onBoundsRef,
    onCapture,
    onCaptureRef,
    onMeasure,
    onMeasurePending,
    onMeasurePendingRef,
    onMeasureRef,
    onSelect,
    onSelectRef,
    onStatus,
    onStatusRef,
    orthographic,
    overlayLabelsRef,
    overlayRef,
    overlaySvgRef,
    overridesRef,
    pickAt,
    pinchRef,
    pinchState,
    placeMeasurePoint,
    pointersRef,
    ready,
    rendererRef,
    requestFrame,
    runCameraLoop,
    section,
    sectionRef,
    seedMeasureCursor,
    selectedExpressId,
    selectedRef,
    setDragging,
    setHovering,
    setReady,
    sourceUrl,
    streamingRef,
    t,
    testHover,
    themeRef,
    touchFramedAtRef,
    view,
    viewNonce,
    xrayKeepIds,
    xrayRef,
    zoomToSelection,
  }
}

export type IfcViewerCanvasController = ReturnType<typeof useIfcViewerCanvasController>
