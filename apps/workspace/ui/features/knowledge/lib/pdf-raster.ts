export const MAX_PIXEL_RATIO = 3

export const TOUCH_MAX_CANVAS_PIXELS = 5 * 1024 * 1024

export const DESKTOP_MAX_CANVAS_PIXELS = 4096 * 4096

export function maxCanvasPixels(coarsePointer: boolean): number {
  return coarsePointer ? TOUCH_MAX_CANVAS_PIXELS : DESKTOP_MAX_CANVAS_PIXELS
}

export function devicePixelRatioOf(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 1
  return Math.min(value, MAX_PIXEL_RATIO)
}

export interface Raster {
  ratio: number
  width: number
  height: number
  capped: boolean
}

export function rasterFor(options: {
  width: number
  height: number
  dpr: number
  maxPixels: number
}): Raster {
  const { width, height, maxPixels } = options
  const dpr = devicePixelRatioOf(options.dpr)
  if (width <= 0 || height <= 0) return { ratio: dpr, width: 0, height: 0, capped: false }
  const budgetRatio = Math.sqrt(maxPixels / (width * height))
  const ratio = Math.min(dpr, budgetRatio)
  return {
    ratio,
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
    capped: budgetRatio < dpr,
  }
}

export function sameRaster(
  drawn: { width: number; height: number },
  wanted: { width: number; height: number }
): boolean {
  return Math.abs(drawn.width - wanted.width) <= 2 && Math.abs(drawn.height - wanted.height) <= 2
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export function visiblePart(page: Box, view: Box): Box | null {
  const left = Math.max(page.x, view.x)
  const top = Math.max(page.y, view.y)
  const right = Math.min(page.x + page.width, view.x + view.width)
  const bottom = Math.min(page.y + page.height, view.y + view.height)
  if (right - left < 1 || bottom - top < 1) return null
  return { x: left - page.x, y: top - page.y, width: right - left, height: bottom - top }
}

export const DETAIL_MARGIN = 0.5

export interface DetailPlan {
  region: Box
  raster: Raster
}

export function detailPlan(options: {
  page: { width: number; height: number }
  visible: Box | null
  base: Raster
  dpr: number
  maxPixels: number
}): DetailPlan | null {
  const { page, visible, base, maxPixels } = options
  const dpr = devicePixelRatioOf(options.dpr)
  if (!visible || !base.capped || base.ratio >= dpr * 0.95 || page.width <= 0 || page.height <= 0)
    return null
  const budget = maxPixels / (dpr * dpr)
  let margin = DETAIL_MARGIN
  let region = grow(visible, page, margin)
  for (let step = 0; step < 6 && region.width * region.height > budget; step += 1) {
    margin /= 2
    region = grow(visible, page, margin)
  }
  if (region.width * region.height > budget) region = visible
  return {
    region,
    raster: rasterFor({ width: region.width, height: region.height, dpr, maxPixels }),
  }
}

function grow(box: Box, page: { width: number; height: number }, margin: number): Box {
  const dx = box.width * margin
  const dy = box.height * margin
  const x = Math.max(0, box.x - dx)
  const y = Math.max(0, box.y - dy)
  const right = Math.min(page.width, box.x + box.width + dx)
  const bottom = Math.min(page.height, box.y + box.height + dy)
  return { x, y, width: right - x, height: bottom - y }
}

export function detailCovers(options: {
  drawn: Box
  drawnWidth: number
  pageWidth: number
  visible: Box | null
}): boolean {
  const { drawn, drawnWidth, pageWidth, visible } = options
  if (!visible) return true
  if (Math.abs(drawnWidth - pageWidth) > 0.5) return false
  return (
    visible.x >= drawn.x - 0.5 &&
    visible.y >= drawn.y - 0.5 &&
    visible.x + visible.width <= drawn.x + drawn.width + 0.5 &&
    visible.y + visible.height <= drawn.y + drawn.height + 0.5
  )
}
