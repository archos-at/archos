/**
 * What a calibration's two points and true length say on a page of a given
 * size: the scale, and the ratio 1:N a person reads (ADR-0183). Pure, and with
 * no `server-only`: the review view computes the ratio it shows before saving,
 * and a card that asks a person to confirm a scale shows the same one.
 *
 * A calibration stores no scale. Its places are shares of the page as shown,
 * so the scale follows from the size of the page that is rendered, in points
 * (1/72 inch): metres per point is the true length over the distance in
 * points, and N is that times 1000 mm per metre over 25.4/72 mm per point.
 * The agent's `display_ratio` (`sheet_scale.py`) is the same arithmetic.
 */
import { inRegion, type CalibrationPoint, type CalibrationRegion } from './wire'

/** A page as shown, in points. */
export interface PageSizePt {
  readonly width: number
  readonly height: number
}

const MM_PER_POINT = 25.4 / 72

/** The distance between two places of a page, in points. */
export function distancePt(from: CalibrationPoint, to: CalibrationPoint, page: PageSizePt): number {
  return Math.hypot((to.x - from.x) * page.width, (to.y - from.y) * page.height)
}

/** Metres of the built thing per point of the page; null where the points coincide or a number is not usable. */
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

/** The N of 1:N for a scale. */
export function ratioDenominator(scale: number): number {
  return (scale * 1000) / MM_PER_POINT
}

/**
 * The ratio as a drawing states it: „1:100“, or „5:1“ for a detail drawn
 * larger than life. Rounded to a whole number from 10 up and to one decimal
 * below it; the grouping of thousands is left out, as on a title block.
 */
export function formatRatio(denominator: number): string {
  const round = (value: number) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10)
  if (denominator >= 1) return `1:${round(denominator)}`
  return `${round(1 / denominator)}:1`
}

/** The ratio a calibration gives on a page of this size, ready to show; null where there is none to give. */
export function calibrationRatio(
  calibration: { from: CalibrationPoint; to: CalibrationPoint; lengthM: number },
  page: PageSizePt
): string | null {
  const scale = metresPerPoint(calibration.from, calibration.to, calibration.lengthM, page)
  return scale === null ? null : formatRatio(ratioDenominator(scale))
}

/**
 * The stored region both points lie in: the smallest, where regions nest (a
 * detail inside a floor layout has its own scale). Null where no single region
 * holds both, and the person draws the region.
 */
export function regionHolding(
  regions: readonly CalibrationRegion[],
  from: CalibrationPoint,
  to: CalibrationPoint
): CalibrationRegion | null {
  const holding = regions.filter((region) => inRegion(from, region) && inRegion(to, region))
  if (holding.length === 0) return null
  return holding.reduce((smallest, region) => (region.w * region.h < smallest.w * smallest.h ? region : smallest))
}

/** The box two corners span, as a region; null where it has no width or no height. */
export function regionBetween(a: CalibrationPoint, b: CalibrationPoint): CalibrationRegion | null {
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const x = clamp(Math.min(a.x, b.x))
  const y = clamp(Math.min(a.y, b.y))
  const w = clamp(Math.max(a.x, b.x)) - x
  const h = clamp(Math.max(a.y, b.y)) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}
