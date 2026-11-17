import type { BimCameraView, BimSection } from '../lib/viewer-camera'
import type { BimViewerElement, Rgba } from '../lib/model-index'
import type { Measurement } from '../lib/viewer-measure'

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
