export const MEASURE_STROKE = {
  halo: '4',
  line: '1.5',
  dash: '4 3',
  haloColor: 'var(--background)',
  lineColor: 'var(--foreground)',
} as const

export const MEASURE_MARKER = {
  radius: 4,
  cursorRadius: 6,
  fill: 'var(--background)',
  stroke: 'var(--foreground)',
  strokeWidth: MEASURE_STROKE.line,
} as const

export type MeasureMarkerShape = 'square' | 'diamond' | 'circle'

export function measureMarkerPath(shape: MeasureMarkerShape, radius: number = MEASURE_MARKER.radius): string {
  switch (shape) {
    case 'square':
      return `M ${-radius} ${-radius} H ${radius} V ${radius} H ${-radius} Z`
    case 'diamond':
      return `M 0 ${-radius} L ${radius} 0 L 0 ${radius} L ${-radius} 0 Z`
    default:
      return `M ${-radius} 0 a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
  }
}
