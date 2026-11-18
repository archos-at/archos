import { useEffect } from 'react'
import type { IfcViewerState } from './use-ifc-viewer-state'
import type { IfcViewerFrame } from './use-ifc-viewer-frame'

export function useIfcViewerScene(viewer: IfcViewerState & IfcViewerFrame) {
  const {
    canvasRef,
    colorOverrides,
    hiddenExpressIds,
    isolatedExpressIds,
    ready,
    rendererRef,
    requestFrame,
    selectedExpressId,
    xrayKeepIds,
  } = viewer
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
}
