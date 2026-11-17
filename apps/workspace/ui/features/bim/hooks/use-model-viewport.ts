'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildColorOverrides,
  expressIdsForStorey,
  hasVisibilityEdits,
  NOTHING_HIDDEN,
  resolveHighlights,
  resolveIsolation,
  sameIdSet,
  sameVisibility,
  selectionSurvives,
  supportsWebGpu,
  type BimHighlightGroup,
  type BimViewerElement,
  type ResolvedHighlight,
  type ViewerVisibility,
} from '../lib/model-index'
import {
  clampCut,
  defaultCameraState,
  type BimCameraView,
  type BimSection,
  type BimViewerCameraState,
} from '../lib/viewer-camera'
import { addMeasurement, type Measurement } from '../lib/viewer-measure'
import type { IfcViewerCanvasProps, IfcViewerStatus } from '../components/ifc-viewer-canvas'

const EMPTY_MEASUREMENTS: readonly Measurement[] = []

export interface UseModelViewportOptions {
  sourceUrl: string | null
  elements: readonly BimViewerElement[]
  highlights?: readonly BimHighlightGroup[]
  isolatedStorey?: string | null
  selectedGlobalId?: string | null
  onSelect?: (element: BimViewerElement | null) => void
  xray?: boolean
  camera?: BimViewerCameraState
  onCameraChange?: (camera: BimViewerCameraState) => void
  compact?: boolean
  onCapture?: (dataUrl: string | null) => void
  onVisibilityEdit?: (previous: ViewerVisibility) => void
}

export interface ModelMeasuring {
  active: boolean
  pending: boolean
  measurements: readonly Measurement[]
  setActive: (active: boolean) => void
  clear: () => void
}

export interface ModelVisibility extends ViewerVisibility {
  edited: boolean
  hide: (expressId: number) => void
  isolate: (expressIds: readonly number[]) => void
  showEverything: () => void
  restore: (edits: ViewerVisibility) => void
}

export interface ModelDownload {
  cancelled: boolean
  cancel: () => void
  restart: () => void
}

export interface ModelViewport {
  webGpu: boolean
  status: IfcViewerStatus
  download: ModelDownload
  bounds: { minMetres: number; maxMetres: number } | null
  section: BimSection | null
  selectedExpressId: number | null
  selectedElementExpressId: number | null
  camera: BimViewerCameraState
  highlights: ResolvedHighlight[]
  canvasProps: IfcViewerCanvasProps | null
  setView: (view: BimCameraView) => void
  setSection: (section: BimSection | null) => void
  previewCut: (atMetres: number) => void
  setOrthographic: (orthographic: boolean) => void
  fit: () => void
  defaultCut: (storeyElevation: number | null) => number
  measure: ModelMeasuring
  visibility: ModelVisibility
  capture: () => void
}

export function useModelViewport({
  sourceUrl,
  elements,
  highlights = [],
  isolatedStorey = null,
  selectedGlobalId = null,
  onSelect,
  xray = false,
  camera,
  onCameraChange,
  compact = false,
  onCapture,
  onVisibilityEdit,
}: UseModelViewportOptions): ModelViewport {
  const [status, setStatus] = useState<IfcViewerStatus>({
    phase: 'idle',
    percent: null,
    meshCount: 0,
  })
  const [statusSource, setStatusSource] = useState<string | null>(sourceUrl)
  const current: IfcViewerStatus =
    statusSource === sourceUrl ? status : { phase: 'idle', percent: null, meshCount: 0 }

  const [cancelledSource, setCancelledSource] = useState<string | null>(null)
  const cancelled = cancelledSource !== null && cancelledSource === sourceUrl
  const download = useMemo<ModelDownload>(
    () => ({
      cancelled,
      cancel: () => setCancelledSource(sourceUrl),
      restart: () => {
        setCancelledSource(null)
        setStatusSource(sourceUrl)
        setStatus({ phase: 'idle', percent: null, meshCount: 0 })
      },
    }),
    [cancelled, sourceUrl]
  )

  const [bounds, setBounds] = useState<{ minMetres: number; maxMetres: number } | null>(null)

  const [viewNonce, setViewNonce] = useState(0)
  const [fitNonce, setFitNonce] = useState(0)
  const [captureNonce, setCaptureNonce] = useState(0)

  const [localCamera, setLocalCamera] = useState(defaultCameraState)
  const cameraState = camera ?? localCamera

  const setCamera = useCallback(
    (patch: Partial<BimViewerCameraState>) => {
      const next = { ...cameraState, ...patch }
      if (onCameraChange) onCameraChange(next)
      else setLocalCamera(next)
    },
    [cameraState, onCameraChange]
  )

  const [liveCut, setLiveCut] = useState<number | null>(null)

  const section = useMemo(() => {
    if (!cameraState.section) return null
    const atMetres = liveCut ?? cameraState.section.atMetres
    if (!bounds) return { ...cameraState.section, atMetres }
    return {
      ...cameraState.section,
      atMetres: clampCut(atMetres, { minY: bounds.minMetres, maxY: bounds.maxMetres }),
    }
  }, [cameraState.section, liveCut, bounds])

  useEffect(() => {
    if (liveCut === null) return
    if (!cameraState.section || cameraState.section.atMetres === liveCut) setLiveCut(null)
  }, [cameraState.section, liveCut])

  const setView = useCallback(
    (view: BimCameraView) => {
      setViewNonce((n) => n + 1)
      setCamera({ view, orthographic: view !== 'iso' })
    },
    [setCamera]
  )

  const setSection = useCallback((next: BimSection | null) => setCamera({ section: next }), [setCamera])

  const previewCut = useCallback(
    (atMetres: number) =>
      setLiveCut(
        bounds
          ? clampCut(atMetres, { minY: bounds.minMetres, maxY: bounds.maxMetres })
          : atMetres
      ),
    [bounds]
  )
  const setOrthographic = useCallback(
    (orthographic: boolean) => setCamera({ orthographic }),
    [setCamera]
  )
  const fit = useCallback(() => setFitNonce((n) => n + 1), [])
  const capture = useCallback(() => setCaptureNonce((n) => n + 1), [])

  const defaultCut = useCallback(
    (storeyElevation: number | null): number => {
      if (storeyElevation !== null) return Math.round((storeyElevation + 1) * 100) / 100
      if (!bounds) return 0
      const third = bounds.minMetres + (bounds.maxMetres - bounds.minMetres) / 3
      return Math.round(third * 100) / 100
    },
    [bounds]
  )

  const [measuring, setMeasuring] = useState(false)
  const [measurePending, setMeasurePending] = useState(false)
  const [measurements, setMeasurements] = useState<readonly Measurement[]>(EMPTY_MEASUREMENTS)

  const handleMeasure = useCallback((measurement: Measurement) => {
    setMeasurements((existing) => addMeasurement(existing, measurement))
  }, [])

  const setMeasureActive = useCallback((active: boolean) => {
    setMeasuring(active)
    if (!active) setMeasurePending(false)
  }, [])

  const clearMeasurements = useCallback(() => {
    setMeasurements(EMPTY_MEASUREMENTS)
    setMeasurePending(false)
  }, [])

  const measure = useMemo<ModelMeasuring>(
    () => ({
      active: measuring,
      pending: measurePending,
      measurements,
      setActive: setMeasureActive,
      clear: clearMeasurements,
    }),
    [measuring, measurePending, measurements, setMeasureActive, clearMeasurements]
  )

  useEffect(() => {
    setMeasurements(EMPTY_MEASUREMENTS)
    setMeasurePending(false)
  }, [sourceUrl])

  useEffect(() => {
    setBounds(null)
  }, [sourceUrl])

  const webGpu = useMemo(() => supportsWebGpu(), [])

  const resolved = useMemo(() => resolveHighlights(highlights, elements), [highlights, elements])
  const colorOverrides = useMemo(() => buildColorOverrides(resolved), [resolved])

  const [edits, setEdits] = useState<ViewerVisibility>(NOTHING_HIDDEN)

  useEffect(() => {
    setEdits(NOTHING_HIDDEN)
  }, [sourceUrl])

  const onVisibilityEditRef = useRef(onVisibilityEdit)
  onVisibilityEditRef.current = onVisibilityEdit

  const visibility = useMemo<ModelVisibility>(() => {
    const apply = (next: ViewerVisibility): void => {
      if (sameVisibility(edits, next)) return
      onVisibilityEditRef.current?.(edits)
      setEdits(next)
    }
    return {
      ...edits,
      edited: hasVisibilityEdits(edits),
      hide: (expressId) => apply({ ...edits, hidden: new Set(edits.hidden).add(expressId) }),
      isolate: (expressIds) => {
        const next = new Set(expressIds)
        const pressedAgain = sameIdSet(edits.isolated, next)
        apply({ ...edits, isolated: pressedAgain ? null : next })
      },
      showEverything: () => apply(NOTHING_HIDDEN),
      restore: (restored) => setEdits(restored),
    }
  }, [edits])

  const storeyExpressIds = useMemo(
    () => expressIdsForStorey(elements, isolatedStorey),
    [elements, isolatedStorey]
  )
  const isolatedExpressIds = useMemo(
    () => resolveIsolation(storeyExpressIds, edits.isolated),
    [storeyExpressIds, edits.isolated]
  )

  const selectedElementExpressId = useMemo(
    () => elements.find((element) => element.globalId === selectedGlobalId)?.expressId ?? null,
    [elements, selectedGlobalId]
  )

  const selectedExpressId = useMemo(
    () => (selectionSurvives(selectedElementExpressId, edits) ? selectedElementExpressId : null),
    [selectedElementExpressId, edits]
  )

  const xrayKeepIds = useMemo(() => {
    if (!xray) return null
    const ids = new Set<number>()
    for (const group of resolved) for (const id of group.expressIds) ids.add(id)
    if (selectedExpressId !== null) ids.add(selectedExpressId)
    return ids.size > 0 ? ids : null
  }, [xray, resolved, selectedExpressId])

  const [clickedInCanvas, setClickedInCanvas] = useState<string | null>(null)
  const handleCanvasSelect = useCallback(
    (element: BimViewerElement | null) => {
      setClickedInCanvas(element?.globalId ?? null)
      onSelect?.(element)
    },
    [onSelect]
  )

  useEffect(() => {
    if (clickedInCanvas !== null && selectedGlobalId !== clickedInCanvas) setClickedInCanvas(null)
  }, [selectedGlobalId, clickedInCanvas])

  const zoomToSelection = selectedGlobalId !== null && selectedGlobalId !== clickedInCanvas

  const handleStatus = useCallback(
    (next: IfcViewerStatus) => {
      setStatusSource(sourceUrl)
      setStatus(next)
    },
    [sourceUrl]
  )

  const canvasProps = useMemo<IfcViewerCanvasProps | null>(() => {
    if (!webGpu || !sourceUrl) return null
    return {
      sourceUrl,
      elements,
      colorOverrides,
      isolatedExpressIds,
      hiddenExpressIds: edits.hidden,
      selectedExpressId,
      xrayKeepIds,
      view: cameraState.view,
      viewNonce,
      fitNonce,
      captureNonce,
      onCapture,
      orthographic: cameraState.orthographic,
      section,
      onBounds: setBounds,
      onSelect: handleCanvasSelect,
      zoomToSelection,
      compact,
      measuring,
      measurements,
      onMeasure: handleMeasure,
      onMeasurePending: setMeasurePending,
      onStatus: handleStatus,
    }
  }, [
    webGpu,
    sourceUrl,
    elements,
    colorOverrides,
    isolatedExpressIds,
    edits.hidden,
    selectedExpressId,
    xrayKeepIds,
    cameraState.view,
    cameraState.orthographic,
    viewNonce,
    fitNonce,
    captureNonce,
    onCapture,
    section,
    handleCanvasSelect,
    zoomToSelection,
    compact,
    measuring,
    measurements,
    handleMeasure,
    handleStatus,
  ])

  return {
    webGpu,
    status: current,
    download,
    bounds,
    section,
    selectedExpressId,
    selectedElementExpressId,
    camera: cameraState,
    highlights: resolved,
    canvasProps,
    setView,
    setSection,
    previewCut,
    setOrthographic,
    fit,
    defaultCut,
    measure,
    visibility,
    capture,
  }
}
