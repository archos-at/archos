export type MeasureMarkKind = 'vertex' | 'edge' | 'face' | 'free'

export type MeasureMarkerShape = 'square' | 'diamond' | 'circle'

export type MeasureSurface = 'scene' | 'paper'

export const MEASURE_SURFACE = {
  scene: {
    ink: 'var(--foreground)',
    halo: 'var(--background)',
    labelFill: 'bg-sheet',
    labelText: 'text-foreground',
    labelProvisional: 'text-muted-foreground',
  },
  paper: {
    ink: 'var(--paper-ink)',
    halo: 'var(--paper-ink-foreground)',
    labelFill: 'bg-paper-ink-foreground',
    labelText: 'text-paper-ink',
    labelProvisional: 'text-paper-ink/65',
  },
} as const satisfies Record<MeasureSurface, { ink: string; halo: string; labelFill: string; labelText: string; labelProvisional: string }>

export const MEASURE_STROKE = {
  ink: MEASURE_SURFACE.scene.ink,
  halo: MEASURE_SURFACE.scene.halo,
  lineWidth: 1.5,
  haloWidth: 4,
  placingDash: '4 3',
  cap: 'round',
  join: 'round',
  areaFillOpacity: 0.08,
} as const

export const MEASURE_MARKER = {
  radius: 4,
  cursorRadius: 6,
  fill: MEASURE_SURFACE.scene.halo,
  stroke: MEASURE_SURFACE.scene.ink,
  strokeWidth: 1.5,
} as const

export const MEASURE_MARKER_SHAPE: Record<MeasureMarkKind, MeasureMarkerShape> = {
  vertex: 'square',
  edge: 'diamond',
  face: 'circle',
  free: 'circle',
}

export const MEASURE_LABEL_SHAPE_CLASS = 'shadow-xs rounded-full px-1.5 text-meta font-medium whitespace-nowrap tabular-nums'

export function measureLabelClass(surface: MeasureSurface = 'scene', provisional = false): string {
  const tone = MEASURE_SURFACE[surface]
  return `${tone.labelFill} ${provisional ? tone.labelProvisional : tone.labelText} ${MEASURE_LABEL_SHAPE_CLASS}`
}

export const MEASURE_LABEL_CLASS = measureLabelClass('scene')

export const MEASURE_LABEL_AT_CLASS = 'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2'

export const MEASURE_PROVISIONAL_SIGN = '≈'

export function measureMarkerPath(kind: MeasureMarkKind, radius: number = MEASURE_MARKER.radius): string {
  switch (MEASURE_MARKER_SHAPE[kind]) {
    case 'square':
      return `M ${-radius} ${-radius} H ${radius} V ${radius} H ${-radius} Z`
    case 'diamond':
      return `M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`
    default:
      return `M ${-radius} 0 a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
  }
}

export type MeasureMarkPoint = readonly [number, number]

function vertexMean(points: readonly MeasureMarkPoint[]): MeasureMarkPoint {
  const count = Math.max(points.length, 1)
  return [points.reduce((sum, [x]) => sum + x, 0) / count, points.reduce((sum, [, y]) => sum + y, 0) / count]
}

function polygonCentroid(points: readonly MeasureMarkPoint[]): MeasureMarkPoint {
  let twiceArea = 0
  let cx = 0
  let cy = 0
  for (const [index, [x0, y0]] of points.entries()) {
    const [x1, y1] = points[(index + 1) % points.length]
    const cross = x0 * y1 - x1 * y0
    twiceArea += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(twiceArea) < 1e-9) return vertexMean(points)
  return [cx / (3 * twiceArea), cy / (3 * twiceArea)]
}

function halfwayAlong(points: readonly MeasureMarkPoint[]): MeasureMarkPoint {
  const legs = points.slice(1).map(([x, y], index) => Math.hypot(x - points[index][0], y - points[index][1]))
  let left = legs.reduce((sum, leg) => sum + leg, 0) / 2
  for (const [index, leg] of legs.entries()) {
    if (left <= leg && leg > 0) {
      const [[x0, y0], [x1, y1]] = [points[index], points[index + 1]]
      return [x0 + ((x1 - x0) * left) / leg, y0 + ((y1 - y0) * left) / leg]
    }
    left -= leg
  }
  return points[0]
}

export function labelAnchor(points: readonly MeasureMarkPoint[], closed = false): MeasureMarkPoint {
  if (points.length === 0) return [0, 0]
  if (points.length === 1) return points[0]
  return closed && points.length >= 3 ? polygonCentroid(points) : halfwayAlong(points)
}
