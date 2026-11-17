import { useCallback, useEffect, useRef } from 'react'
import { boundsCentre, rendererPreset } from '../lib/viewer-camera'
import { captureFrameOptions } from '../lib/viewer-performance'
import { modelBoundsMetres } from '../components/ifc-viewer-canvas-helpers'
import type { IfcViewerState } from './use-ifc-viewer-state'
import type { IfcViewerFrame } from './use-ifc-viewer-frame'

export function useIfcViewerCamera(viewer: IfcViewerState & IfcViewerFrame) {
  const {
    captureNonce,
    fitNonce,
    fittedOnLoadRef,
    frameOptions,
    onBoundsRef,
    onCaptureRef,
    orthographic,
    ready,
    rendererRef,
    requestFrame,
    runCameraLoop,
    section,
    selectedExpressId,
    view,
    viewNonce,
    zoomToSelection,
  } = viewer
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

  return {
    fitModel,
    fittedRef,
    capturedRef,
  }
}

export type IfcViewerCamera = ReturnType<typeof useIfcViewerCamera>
