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

const SVG_NS = 'http://www.w3.org/2000/svg'

export type Projector = (point: MeasurePoint) => { x: number; y: number } | null

export interface MeasureOverlayLabels {
  horizontal: string
  vertical: string
  locale: string
}

const TICK_RADIUS = 4
const CURSOR_RADIUS = 6

const SNAP_SHAPE: Record<MeasureSnapKind, 'square' | 'diamond' | 'circle'> = {
  vertex: 'square',
  edge: 'diamond',
  face: 'circle',
  face_center: 'circle',
  point_cloud: 'circle',
  none: 'circle',
}

const HALO_WIDTH = '4'
const LINE_WIDTH = '1.5'

interface MeasurementNodes {
  halo: SVGLineElement
  line: SVGLineElement
  from: SVGPathElement
  to: SVGPathElement
  label: HTMLDivElement
  measurement: Measurement
}

function markerPath(kind: MeasureSnapKind, radius: number): string {
  switch (SNAP_SHAPE[kind]) {
    case 'square':
      return `M ${-radius} ${-radius} H ${radius} V ${radius} H ${-radius} Z`
    case 'diamond':
      return `M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`
    default:
      return `M ${-radius} 0 a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
  }
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
      label.className =
        'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-background/95 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap tabular-nums shadow-sm'
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
      this.pendingLabel.className =
        'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-background/95 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap tabular-nums shadow-sm'
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
    halo.setAttribute('stroke', 'var(--background)')
    halo.setAttribute('stroke-width', HALO_WIDTH)
    halo.setAttribute('stroke-linecap', 'round')
    halo.setAttribute('vector-effect', 'non-scaling-stroke')

    const line = this.svg.appendChild(document.createElementNS(SVG_NS, 'line'))
    line.setAttribute('stroke', 'var(--foreground)')
    line.setAttribute('stroke-width', LINE_WIDTH)
    line.setAttribute('vector-effect', 'non-scaling-stroke')

    if (dashed) {
      halo.setAttribute('stroke-dasharray', '4 3')
      line.setAttribute('stroke-dasharray', '4 3')
    }
    return { halo, line }
  }

  private appendMarker(kind: MeasureSnapKind, radius: number): SVGPathElement {
    const marker = this.svg.appendChild(document.createElementNS(SVG_NS, 'path'))
    marker.setAttribute('d', markerPath(kind, radius))
    marker.setAttribute('fill', 'var(--background)')
    marker.setAttribute('stroke', 'var(--foreground)')
    marker.setAttribute('stroke-width', '1.5')
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
