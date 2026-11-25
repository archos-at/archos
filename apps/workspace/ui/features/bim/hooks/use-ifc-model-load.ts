import { useEffect } from 'react'
import { capturePosthog, capturePosthogException } from '@/lib/analytics/posthog'
import { unwrapModelSource } from '../lib/model-source'
import { downloadWithProgress } from '../lib/viewer-camera'
import { readViewerTheme } from '../lib/viewer-scene'
import { runExclusive } from '../lib/geometry-queue'
import { classifyLoadFailure, GpuInitError, ModelDownloadError } from '../lib/load-failure'
import { guardedKernel, type RendererLike } from '../components/ifc-viewer-canvas-helpers'
import type { IfcViewerStatus } from '../components/ifc-viewer-canvas-contract'
import type { IfcViewerState } from './use-ifc-viewer-state'
import type { IfcViewerFrame } from './use-ifc-viewer-frame'

type LoadPhase = 'downloading' | 'waiting' | 'building' | 'finalizing'

export function useIfcModelLoad(viewer: IfcViewerState & IfcViewerFrame) {
  const {
    cameraLoopRef,
    canvasRef,
    elementsRef,
    fittedOnLoadRef,
    frameRef,
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
    let finished = false
    const controller = new AbortController()
    const canvas = canvasRef.current
    if (!canvas) return

    themeRef.current = readViewerTheme()
    streamingRef.current = true

    const report = (status: IfcViewerStatus) => {
      if (!cancelled) onStatusRef.current?.(status)
    }

    const kernel = guardedKernel()
    const startedAt = performance.now()
    const timings: Partial<Record<LoadPhase, number>> = {}
    let phase: LoadPhase = 'downloading'
    let phaseStartedAt = startedAt
    const enter = (next: LoadPhase) => {
      timings[phase] = Math.round(performance.now() - phaseStartedAt)
      phase = next
      phaseStartedAt = performance.now()
    }
    let downloadedBytes = 0

    const dropRenderer = (renderer: RendererLike) => {
      renderer.destroy()
      if (rendererRef.current === renderer) rendererRef.current = null
    }

    const run = async () => {
      report({ phase: 'downloading', percent: 0, meshCount: 0 })
      try {
        const response = await fetch(sourceUrl, { signal: controller.signal })
        if (!response.ok) throw new ModelDownloadError(response.status)
        const downloaded = await downloadWithProgress(response, (percent, bytes) => {
          if (!cancelled) report({ phase: 'downloading', percent, meshCount: 0, bytes })
        })
        if (cancelled) return
        downloadedBytes = downloaded.byteLength
        const buffer = await unwrapModelSource(downloaded)
        if (cancelled) return

        enter('waiting')
        report({ phase: 'parsing', percent: null, meshCount: 0 })
        const meshCount = await runExclusive(controller.signal, async () => {
          enter('building')
          const [{ GeometryProcessor }, { Renderer }] = await Promise.all([
            import('@ifc-lite/geometry'),
            import('@ifc-lite/renderer'),
          ])
          if (cancelled) return null

          const geometry = new GeometryProcessor()
          const renderer: RendererLike = new Renderer(canvas)
          rendererRef.current = renderer
          try {
            await Promise.all([geometry.init().then(() => kernel.hold(geometry)), renderer.init()])
          } catch (error) {
            dropRenderer(renderer)
            throw new GpuInitError(error)
          }
          if (cancelled) {
            dropRenderer(renderer)
            return null
          }

          renderer.getScene().setLodBuildsEnabled(true)
          try {
            await renderer.enableQuantizedBatches()
          } catch (error) {
            capturePosthogException(error, { source: 'ifc-viewer-quantized-batches' })
          }
          if (cancelled) {
            dropRenderer(renderer)
            return null
          }

          renderer.onDeviceLost?.((info) => {
            capturePosthogException(new Error(info.message), { source: 'ifc-viewer-device-lost' })
            report({ phase: 'error', percent: null, meshCount: 0, cause: 'device-lost' })
          })

          let count = 0
          for await (const event of geometry.processAdaptive(buffer)) {
            if (cancelled) break
            if (event.type !== 'batch') continue
            renderer.addMeshes(event.meshes, true)
            count += event.meshes.length
            report({ phase: 'parsing', percent: null, meshCount: count })
            requestFrame()
          }
          kernel.release()
          return cancelled ? null : count
        })
        if (cancelled || meshCount === null) return
        const renderer = rendererRef.current
        if (!renderer) return

        enter('finalizing')
        streamingRef.current = false
        const device = renderer.getGPUDevice?.()
        const pipeline = renderer.getPipeline?.()
        if (device && pipeline) {
          try {
            await renderer.getScene().finalizeStreamingAsync?.(device, pipeline)
          } catch (error) {
            capturePosthogException(error, { source: 'ifc-viewer-finalize' })
          }
          if (cancelled) return
        }

        const bounds = renderer.getModelBounds()
        if (bounds) renderer.getCamera().setSceneBounds?.(bounds)
        renderer.fitToView()
        fittedOnLoadRef.current = true
        timings.finalizing = Math.round(performance.now() - phaseStartedAt)
        finished = true
        setReady(true)
        report({ phase: 'ready', percent: 100, meshCount })
        capturePosthog('ifc_model_opened', {
          element_count: elementsRef.current.length,
          mesh_count: meshCount,
          bytes: downloadedBytes,
          load_ms: Math.round(performance.now() - startedAt),
          download_ms: timings.downloading ?? null,
          wait_ms: timings.waiting ?? null,
          build_ms: timings.building ?? null,
          finalize_ms: timings.finalizing ?? null,
        })
        requestFrame()
      } catch (error) {
        if (controller.signal.aborted) return
        finished = true
        const { cause, httpStatus } = classifyLoadFailure(error)
        capturePosthogException(error instanceof GpuInitError ? error.cause : error, {
          source: 'ifc-viewer-load',
          phase,
        })
        capturePosthog('ifc_model_load_failed', {
          cause,
          http_status: httpStatus,
          phase,
          elapsed_ms: Math.round(performance.now() - startedAt),
        })
        report({ phase: 'error', percent: null, meshCount: 0, cause })
      }
    }

    void run().finally(() => kernel.release())

    return () => {
      cancelled = true
      controller.abort()
      if (!finished) {
        capturePosthog('ifc_model_load_stopped', {
          phase,
          elapsed_ms: Math.round(performance.now() - startedAt),
          bytes: downloadedBytes,
        })
      }
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      if (cameraLoopRef.current !== null) cancelAnimationFrame(cameraLoopRef.current)
      cameraLoopRef.current = null
      rendererRef.current?.destroy()
      rendererRef.current = null
      kernel.release()
      setReady(false)
      setHovering(false)
    }
  }, [sourceUrl, requestFrame])
}
