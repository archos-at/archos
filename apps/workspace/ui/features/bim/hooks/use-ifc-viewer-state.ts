import { useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { RendererLike } from '../components/ifc-viewer-canvas-helpers'
import type { MeasureOverlay } from '../lib/measure-overlay'
import type { MeasureAnchor } from '../lib/viewer-measure'
import type { IfcViewerCanvasProps } from '../components/ifc-viewer-canvas-contract'

export function useIfcViewerState(props: IfcViewerCanvasProps) {
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

  const fittedOnLoadRef = useRef(false)

  return {
    sourceUrl,
    elements,
    colorOverrides,
    isolatedExpressIds,
    hiddenExpressIds,
    selectedExpressId,
    xrayKeepIds,
    onSelect,
    onStatus,
    view,
    orthographic,
    section,
    onBounds,
    viewNonce,
    fitNonce,
    zoomToSelection,
    compact,
    measuring,
    measurements,
    onMeasure,
    onMeasurePending,
    captureNonce,
    onCapture,
    className,
    t,
    locale,
    keysId,
    canvasRef,
    overlaySvgRef,
    overlayLabelsRef,
    rendererRef,
    geometryRef,
    ready,
    setReady,
    hovering,
    setHovering,
    dragging,
    setDragging,
    overridesRef,
    isolatedRef,
    hiddenRef,
    selectedRef,
    xrayRef,
    sectionRef,
    compactRef,
    elementsRef,
    onStatusRef,
    onSelectRef,
    onBoundsRef,
    onMeasureRef,
    onMeasurePendingRef,
    measuringRef,
    onCaptureRef,
    overlayRef,
    anchorRef,
    cursorRef,
    themeRef,
    interactingRef,
    streamingRef,
    fittedOnLoadRef,
  }
}

export type IfcViewerState = ReturnType<typeof useIfcViewerState>
