import { formatMetresIn } from './format-value'
import type { SnapOptions } from '@ifc-lite/renderer'

export interface MeasurePoint {
  x: number
  y: number
  z: number
}

export type MeasureSnapKind = 'vertex' | 'edge' | 'face' | 'face_center' | 'point_cloud' | 'none'

export interface MeasureAnchor {
  point: MeasurePoint
  snap: MeasureSnapKind
}

export interface Measurement {
  id: string
  from: MeasureAnchor
  to: MeasureAnchor
}

export const MEASURE_SNAP_OPTIONS: Partial<SnapOptions> = {
  snapToVertices: true,
  snapToEdges: true,
  snapToFaces: true,
  screenSnapRadius: 20,
  snapRadius: 0.1,
}

export function distanceMetres(from: MeasurePoint, to: MeasurePoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
}

export function horizontalMetres(from: MeasurePoint, to: MeasurePoint): number {
  return Math.hypot(to.x - from.x, to.z - from.z)
}

export function verticalMetres(from: MeasurePoint, to: MeasurePoint): number {
  return to.y - from.y
}

export function midpoint(from: MeasurePoint, to: MeasurePoint): MeasurePoint {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    z: (from.z + to.z) / 2,
  }
}

export function isSkew(from: MeasurePoint, to: MeasurePoint): boolean {
  const horizontal = horizontalMetres(from, to)
  const vertical = Math.abs(verticalMetres(from, to))
  return horizontal >= 0.005 && vertical >= 0.005
}

export function formatMetres(metres: number, locale: string): string {
  if (!Number.isFinite(metres)) return '—'
  const magnitude = Math.abs(metres)
  if (magnitude < 0.01) return `${Math.round(metres * 1000).toLocaleString(locale)} mm`
  return `${formatMetresIn(metres, locale)} m`
}

export function measurementId(from: MeasurePoint, to: MeasurePoint): string {
  const at = (point: MeasurePoint) =>
    `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z.toFixed(3)}`
  return `${at(from)}|${at(to)}`
}

export function completeMeasurement(
  from: MeasureAnchor,
  to: MeasureAnchor
): Measurement | null {
  if (distanceMetres(from.point, to.point) < 0.001) return null
  return { id: measurementId(from.point, to.point), from, to }
}

export function addMeasurement(
  existing: readonly Measurement[],
  next: Measurement
): Measurement[] {
  return [...existing.filter((candidate) => candidate.id !== next.id), next]
}
