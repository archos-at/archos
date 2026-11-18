import { useEffect } from 'react'
import { capturePosthog } from '@/lib/analytics/posthog'
import { unwrapModelSource } from '../lib/model-source'
import { downloadWithProgress } from '../lib/viewer-camera'
import { readViewerTheme } from '../lib/viewer-scene'
import type { RendererLike } from '../components/ifc-viewer-canvas-helpers'
import type { IfcViewerStatus } from '../components/ifc-viewer-canvas-contract'
import type { IfcViewerState } from './use-ifc-viewer-state'
import type { IfcViewerFrame } from './use-ifc-viewer-frame'

export function useIfcModelLoad(viewer: IfcViewerState & IfcViewerFrame) {
  const {
    cameraLoopRef,
    canvasRef,
    elementsRef,
    fittedOnLoadRef,
    frameRef,
    geometryRef,
    onStatusRef,
    rendererRef,
    requestFrame,
    setHovering,
    setReady,
    sourceUrl,
    streamingRef,
    themeRef,
  } = viewer
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
}
