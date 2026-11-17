import type { PageSize } from '../types'

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const
export const FIT_ZOOM = 1
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 16

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return FIT_ZOOM
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)
}

export function nextZoom(zoom: number, direction: 1 | -1): number {
  const current = clampZoom(zoom)
  const epsilon = 1e-6
  if (direction > 0) return ZOOM_STEPS.find((step) => step > current + epsilon) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((step) => step < current - epsilon) ?? MIN_ZOOM
}

export const isFitZoom = (zoom: number): boolean => Math.abs(zoom - FIT_ZOOM) < 0.01

export function clampPage(page: number, count: number): number {
  const last = Math.max(1, Math.trunc(count) || 1)
  const whole = Math.trunc(page)
  return Math.min(Math.max(Number.isFinite(whole) ? whole : 1, 1), last)
}

export function pageSpan(
  olderCount: number,
  newerCount: number,
): { count: number; differs: boolean } {
  return {
    count: Math.max(olderCount, newerCount, 1),
    differs: olderCount !== newerCount,
  }
}

export function hasPage(count: number, page: number): boolean {
  return page >= 1 && page <= count
}

export function commonStage(sizes: readonly PageSize[]): PageSize | null {
  if (sizes.length === 0) return null
  return {
    width: Math.max(...sizes.map((size) => size.width)),
    height: Math.max(...sizes.map((size) => size.height)),
  }
}

export function fitScale(
  available: { width: number; height?: number },
  stage: PageSize,
  zoom: number,
): number {
  if (available.width <= 0 || stage.width <= 0 || stage.height <= 0) return 0
  const byWidth = available.width / stage.width
  const byHeight =
    available.height !== undefined && available.height > 0
      ? available.height / stage.height
      : Number.POSITIVE_INFINITY
  return Math.min(byWidth, byHeight) * zoom
}
