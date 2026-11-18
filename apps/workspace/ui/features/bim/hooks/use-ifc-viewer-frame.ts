import { useCallback, useEffect, useRef } from 'react'
import type { RenderOptions } from '@ifc-lite/renderer'
import { rendererSectionPlane } from '../lib/viewer-camera'
import { interactiveFrameOptions } from '../lib/viewer-performance'
import { observeViewerTheme, VIEWER_CLEAR_COLOR, viewerEnhancement, viewerEnhancementCompact, viewerEnvironment } from '../lib/viewer-scene'
import { type RendererLike, modelBoundsMetres } from '../components/ifc-viewer-canvas-helpers'
import type { IfcViewerState } from './use-ifc-viewer-state'

export function useIfcViewerFrame(viewer: IfcViewerState) {
  const {
    canvasRef,
    compactRef,
    hiddenRef,
    interactingRef,
    isolatedRef,
    overlayRef,
    rendererRef,
    sectionRef,
    selectedRef,
    streamingRef,
    themeRef,
    xrayRef,
  } = viewer
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

  return {
    hiddenPickOption,
    drawOverlay,
    frameOptions,
    drawFrame,
    requestFrame,
    frameRef,
    cameraLoopRef,
    lastFrameRef,
    runCameraLoop,
  }
}

export type IfcViewerFrame = ReturnType<typeof useIfcViewerFrame>
