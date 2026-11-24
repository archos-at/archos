import { inRegion, type CalibrationPoint, type CalibrationRegion } from './wire'

export interface PageSizePt {
  readonly width: number
  readonly height: number
}

const MM_PER_POINT = 25.4 / 72

export function distancePt(from: CalibrationPoint, to: CalibrationPoint, page: PageSizePt): number {
  return Math.hypot((to.x - from.x) * page.width, (to.y - from.y) * page.height)
}

export function metresPerPoint(
  from: CalibrationPoint,
  to: CalibrationPoint,
  lengthM: number,
  page: PageSizePt
): number | null {
  const distance = distancePt(from, to, page)
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(lengthM) || lengthM <= 0) return null
  return lengthM / distance
}

export function ratioDenominator(scale: number): number {
  return (scale * 1000) / MM_PER_POINT
}

export function formatRatio(denominator: number): string {
  const round = (value: number) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10)
  if (denominator >= 1) return `1:${round(denominator)}`
  return `${round(1 / denominator)}:1`
}

export function calibrationRatio(
  calibration: { from: CalibrationPoint; to: CalibrationPoint; lengthM: number },
  page: PageSizePt
): string | null {
  const scale = metresPerPoint(calibration.from, calibration.to, calibration.lengthM, page)
  return scale === null ? null : formatRatio(ratioDenominator(scale))
}

export function regionHolding(
  regions: readonly CalibrationRegion[],
  from: CalibrationPoint,
  to: CalibrationPoint
): CalibrationRegion | null {
  const holding = regions.filter((region) => inRegion(from, region) && inRegion(to, region))
  if (holding.length === 0) return null
  return holding.reduce((smallest, region) => (region.w * region.h < smallest.w * smallest.h ? region : smallest))
}

export function regionBetween(a: CalibrationPoint, b: CalibrationPoint): CalibrationRegion | null {
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const x = clamp(Math.min(a.x, b.x))
  const y = clamp(Math.min(a.y, b.y))
  const w = clamp(Math.max(a.x, b.x)) - x
  const h = clamp(Math.max(a.y, b.y)) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}
