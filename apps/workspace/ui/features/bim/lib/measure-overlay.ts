import {
  distanceMetres,
  formatMetres,
  horizontalMetres,
  isSkew,
  midpoint,
  verticalMetres,
  type MeasureAnchor,
  type MeasurePoint,
  type Measurement,
  type MeasureSnapKind,
} from './viewer-measure'

import {
  MEASURE_LABEL_AT_CLASS,
  MEASURE_LABEL_CLASS,
  MEASURE_MARKER,
  MEASURE_STROKE,
  measureMarkerPath,
  type MeasureMarkKind,
} from '@/components/ui/measure-mark-recipe'

const SVG_NS = 'http://www.w3.org/2000/svg'

export type Projector = (point: MeasurePoint) => { x: number; y: number } | null

export interface MeasureOverlayLabels {
  horizontal: string
  vertical: string
  locale: string
}

const TICK_RADIUS = MEASURE_MARKER.radius
const CURSOR_RADIUS = MEASURE_MARKER.cursorRadius

const MARK_KIND: Record<MeasureSnapKind, MeasureMarkKind> = {
  vertex: 'vertex',
  edge: 'edge',
  face: 'face',
  face_center: 'face',
  point_cloud: 'face',
  none: 'free',
}

const LABEL_CLASS = `${MEASURE_LABEL_AT_CLASS} ${MEASURE_LABEL_CLASS}`

interface MeasurementNodes {
  halo: SVGLineElement
  line: SVGLineElement
  from: SVGPathElement
  to: SVGPathElement
  label: HTMLDivElement
  measurement: Measurement
}

function markerPath(kind: MeasureSnapKind, radius: number): string {
  return measureMarkerPath(MARK_KIND[kind], radius)
}

export function measurementText(
  measurement: Measurement,
  labels: MeasureOverlayLabels
): string {
  const { from, to } = measurement
  const total = formatMetres(distanceMetres(from.point, to.point), labels.locale)
  if (!isSkew(from.point, to.point)) return total
  const run = formatMetres(horizontalMetres(from.point, to.point), labels.locale)
  const rise = formatMetres(Math.abs(verticalMetres(from.point, to.point)), labels.locale)
  return `${total} · ${labels.horizontal} ${run} · ${labels.vertical} ${rise}`
}

export class MeasureOverlay {
  private readonly svg: SVGSVGElement
  private readonly labelLayer: HTMLElement
  private readonly labels: MeasureOverlayLabels
  private nodes: MeasurementNodes[] = []

  private pendingHalo: SVGLineElement | null = null
  private pendingLine: SVGLineElement | null = null
  private pendingMarker: SVGPathElement | null = null
  private pendingLabel: HTMLDivElement | null = null
  private cursorMarker: SVGPathElement | null = null
  private anchor: MeasureAnchor | null = null
  private cursor: MeasureAnchor | null = null

  constructor(svg: SVGSVGElement, labelLayer: HTMLElement, labels: MeasureOverlayLabels) {
    this.svg = svg
    this.labelLayer = labelLayer
    this.labels = labels
  }

  setMeasurements(measurements: readonly Measurement[]): void {
    for (const node of this.nodes) {
      node.halo.remove()
      node.line.remove()
      node.from.remove()
      node.to.remove()
      node.label.remove()
    }
    this.nodes = measurements.map((measurement) => {
      const { halo, line } = this.appendLine(false)

      const from = this.appendMarker(measurement.from.snap, TICK_RADIUS)
      const to = this.appendMarker(measurement.to.snap, TICK_RADIUS)

      const label = document.createElement('div')
      label.className = LABEL_CLASS
      label.textContent = measurementText(measurement, this.labels)
      this.labelLayer.appendChild(label)

      return { halo, line, from, to, label, measurement }
    })
  }

  setPending(anchor: MeasureAnchor | null, cursor: MeasureAnchor | null): void {
    this.anchor = anchor
    this.cursor = cursor

    if (anchor && !this.pendingLine) {
      const pending = this.appendLine(true)
      this.pendingHalo = pending.halo
      this.pendingLine = pending.line
      this.pendingMarker = this.appendMarker(anchor.snap, TICK_RADIUS)
      this.pendingLabel = document.createElement('div')
      this.pendingLabel.className = LABEL_CLASS
      this.labelLayer.appendChild(this.pendingLabel)
    }
    if (!anchor) this.clearPending()

    if (cursor && !this.cursorMarker) {
      this.cursorMarker = this.appendMarker(cursor.snap, CURSOR_RADIUS)
    } else if (cursor && this.cursorMarker) {
      this.cursorMarker.setAttribute('d', markerPath(cursor.snap, CURSOR_RADIUS))
    } else if (!cursor && this.cursorMarker) {
      this.cursorMarker.remove()
      this.cursorMarker = null
    }
  }

  update(project: Projector): void {
    for (const node of this.nodes) {
      const from = project(node.measurement.from.point)
      const to = project(node.measurement.to.point)
      if (!from || !to) {
        this.hide(node.halo, node.line, node.from, node.to)
        node.label.style.display = 'none'
        continue
      }
      this.place(node.halo, from, to)
      this.place(node.line, from, to)
      this.placeMarker(node.from, from)
      this.placeMarker(node.to, to)
      const centre = project(midpoint(node.measurement.from.point, node.measurement.to.point))
      if (centre) {
        node.label.style.display = ''
        node.label.style.left = `${centre.x}px`
        node.label.style.top = `${centre.y}px`
      } else {
        node.label.style.display = 'none'
      }
    }

    const anchor = this.anchor ? project(this.anchor.point) : null
    const cursor = this.cursor ? project(this.cursor.point) : null

    if (this.pendingHalo && this.pendingLine && this.pendingMarker) {
      if (anchor && cursor) {
        this.place(this.pendingHalo, anchor, cursor)
        this.place(this.pendingLine, anchor, cursor)
        this.placeMarker(this.pendingMarker, anchor)
      } else {
        this.hide(this.pendingHalo, this.pendingLine, this.pendingMarker)
      }
    }
    if (this.pendingLabel) {
      if (this.anchor && this.cursor && anchor && cursor) {
        this.pendingLabel.style.display = ''
        this.pendingLabel.textContent = formatMetres(
          distanceMetres(this.anchor.point, this.cursor.point),
          this.labels.locale
        )
        this.pendingLabel.style.left = `${(anchor.x + cursor.x) / 2}px`
        this.pendingLabel.style.top = `${(anchor.y + cursor.y) / 2}px`
      } else {
        this.pendingLabel.style.display = 'none'
      }
    }
    if (this.cursorMarker) {
      if (cursor) this.placeMarker(this.cursorMarker, cursor)
      else this.hide(this.cursorMarker)
    }
  }

  destroy(): void {
    this.setMeasurements([])
    this.setPending(null, null)
  }

  private appendLine(dashed: boolean): { halo: SVGLineElement; line: SVGLineElement } {
    const halo = this.svg.appendChild(document.createElementNS(SVG_NS, 'line'))
    halo.setAttribute('stroke', MEASURE_STROKE.halo)
    halo.setAttribute('stroke-width', String(MEASURE_STROKE.haloWidth))
    halo.setAttribute('stroke-linecap', MEASURE_STROKE.cap)
    halo.setAttribute('vector-effect', 'non-scaling-stroke')

    const line = this.svg.appendChild(document.createElementNS(SVG_NS, 'line'))
    line.setAttribute('stroke', MEASURE_STROKE.ink)
    line.setAttribute('stroke-width', String(MEASURE_STROKE.lineWidth))
    line.setAttribute('stroke-linecap', MEASURE_STROKE.cap)
    line.setAttribute('vector-effect', 'non-scaling-stroke')

    if (dashed) {
      halo.setAttribute('stroke-dasharray', MEASURE_STROKE.placingDash)
      line.setAttribute('stroke-dasharray', MEASURE_STROKE.placingDash)
    }
    return { halo, line }
  }

  private appendMarker(kind: MeasureSnapKind, radius: number): SVGPathElement {
    const marker = this.svg.appendChild(document.createElementNS(SVG_NS, 'path'))
    marker.setAttribute('d', markerPath(kind, radius))
    marker.setAttribute('fill', MEASURE_MARKER.fill)
    marker.setAttribute('stroke', MEASURE_MARKER.stroke)
    marker.setAttribute('stroke-width', String(MEASURE_MARKER.strokeWidth))
    return marker
  }

  private clearPending(): void {
    this.pendingHalo?.remove()
    this.pendingLine?.remove()
    this.pendingMarker?.remove()
    this.pendingLabel?.remove()
    this.pendingHalo = null
    this.pendingLine = null
    this.pendingMarker = null
    this.pendingLabel = null
  }

  private place(
    line: SVGLineElement,
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): void {
    line.style.display = ''
    line.setAttribute('x1', String(from.x))
    line.setAttribute('y1', String(from.y))
    line.setAttribute('x2', String(to.x))
    line.setAttribute('y2', String(to.y))
  }

  private placeMarker(marker: SVGPathElement, at: { x: number; y: number }): void {
    marker.style.display = ''
    marker.setAttribute('transform', `translate(${at.x} ${at.y})`)
  }

  private hide(...elements: (SVGElement | null)[]): void {
    for (const element of elements) {
      if (element) element.style.display = 'none'
    }
  }
}
