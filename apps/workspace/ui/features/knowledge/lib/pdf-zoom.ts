export type FitMode = 'width' | 'page'

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = 8
export const ABSOLUTE_MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 32

export const PRINT_SCALE = 96 / 72

export const MAX_PRINT_MAGNIFICATION = 2

export function maxZoomFor(options: { pageWidth: number | null; fitWidth: number }): number {
  const { pageWidth, fitWidth } = options
  if (!pageWidth || pageWidth <= 0 || !Number.isFinite(fitWidth) || fitWidth <= 0) return MAX_ZOOM
  const printZoom = (MAX_PRINT_MAGNIFICATION * PRINT_SCALE * pageWidth) / fitWidth
  return Math.min(ABSOLUTE_MAX_ZOOM, Math.max(MAX_ZOOM, printZoom))
}

export function clampZoom(zoom: number, max: number = MAX_ZOOM): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1
  return Math.min(Math.max(zoom, MIN_ZOOM), Math.max(max, MIN_ZOOM))
}

export function stepZoom(zoom: number, direction: 1 | -1, max: number = MAX_ZOOM): number {
  const current = clampZoom(zoom, max)
  const epsilon = 1e-6
  if (direction > 0) {
    const next = ZOOM_STEPS.find((step) => step > current + epsilon) ?? max
    return Math.min(next, max)
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < current - epsilon) ?? MIN_ZOOM
}

export const DOUBLE_TAP_FACTOR = 2.5

export function doubleTapZoom(zoom: number, max: number = MAX_ZOOM): number {
  const current = clampZoom(zoom, max)
  if (current >= max * 0.98) return 1
  if (current < 1) return 1
  return Math.min(max, current * DOUBLE_TAP_FACTOR)
}

export function twoFingerTapZoom(zoom: number, max: number = MAX_ZOOM): number {
  const current = clampZoom(zoom, max)
  return Math.max(1, Math.min(current, current / DOUBLE_TAP_FACTOR))
}

const RUBBER_BAND = 0.35

export function rubberBandZoom(zoom: number, max: number = MAX_ZOOM): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1
  const ceiling = Math.max(max, MIN_ZOOM)
  if (zoom > ceiling) return ceiling * Math.pow(zoom / ceiling, RUBBER_BAND)
  if (zoom < MIN_ZOOM) return MIN_ZOOM * Math.pow(zoom / MIN_ZOOM, RUBBER_BAND)
  return zoom
}

export function anchoredTransform(options: {
  scale: number
  point: { x: number; y: number }
  origin: { x: number; y: number }
  at: { x: number; y: number }
}): { x: number; y: number; scale: number } {
  const { scale, point, origin, at } = options
  return { x: at.x - origin.x - scale * point.x, y: at.y - origin.y - scale * point.y, scale }
}

export const isFitted = (zoom: number): boolean => Math.abs(zoom - 1) < 0.01

export function clampPage(page: number, count: number): number {
  const last = Math.max(1, Math.trunc(count) || 1)
  const whole = Math.trunc(page)
  return Math.min(Math.max(Number.isFinite(whole) ? whole : 1, 1), last)
}

export function fitWidth(options: {
  mode: FitMode
  frameWidth: number
  frameHeight: number
  aspect: number
  gutter: number
  verticalPadding: number
}): number {
  const { mode, frameWidth, frameHeight, aspect, gutter, verticalPadding } = options
  const byWidth = Math.max(0, frameWidth - gutter)
  if (mode === 'width' || frameHeight <= verticalPadding || aspect <= 0) return byWidth
  return Math.min(byWidth, (frameHeight - verticalPadding) / aspect)
}

export type ViewerKeyAction =
  | { kind: 'page'; to: 'next' | 'previous' | 'first' | 'last' }
  | { kind: 'zoom'; direction: 1 | -1 }
  | { kind: 'fit' }
  | { kind: 'search' }

export function viewerKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  context: { inField: boolean; overflowsSideways: boolean },
): ViewerKeyAction | null {
  const command = event.ctrlKey || event.metaKey
  if (event.altKey) return null
  if (command && event.key.toLowerCase() === 'f') return { kind: 'search' }
  if (context.inField) return null
  if (command && event.key === '0') return { kind: 'fit' }
  if (event.key === '+' || event.key === '=') return { kind: 'zoom', direction: 1 }
  if (event.key === '-' || event.key === '_') return { kind: 'zoom', direction: -1 }
  if (command) return null
  switch (event.key) {
    case 'PageDown':
      return { kind: 'page', to: 'next' }
    case 'PageUp':
      return { kind: 'page', to: 'previous' }
    case 'Home':
      return { kind: 'page', to: 'first' }
    case 'End':
      return { kind: 'page', to: 'last' }
    case 'ArrowRight':
      return context.overflowsSideways ? null : { kind: 'page', to: 'next' }
    case 'ArrowLeft':
      return context.overflowsSideways ? null : { kind: 'page', to: 'previous' }
    default:
      return null
  }
}
