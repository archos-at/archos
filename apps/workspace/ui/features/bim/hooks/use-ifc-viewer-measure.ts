import { useCallback, useEffect } from 'react'
import { MeasureOverlay } from '../lib/measure-overlay'
import { completeMeasurement, MEASURE_SNAP_OPTIONS, type MeasureAnchor, type MeasureSnapKind } from '../lib/viewer-measure'
import type { IfcViewerState } from './use-ifc-viewer-state'
import type { IfcViewerFrame } from './use-ifc-viewer-frame'

export function useIfcViewerMeasure(viewer: IfcViewerState & IfcViewerFrame) {
  const {
    anchorRef,
    canvasRef,
    cursorRef,
    hiddenPickOption,
    isolatedRef,
    locale,
    measurements,
    measuring,
    onMeasurePendingRef,
    onMeasureRef,
    overlayLabelsRef,
    overlayRef,
    overlaySvgRef,
    rendererRef,
    requestFrame,
    t,
  } = viewer
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

  return {
    measureAt,
    seedMeasureCursor,
    placeMeasurePoint,
  }
}

export type IfcViewerMeasure = ReturnType<typeof useIfcViewerMeasure>
