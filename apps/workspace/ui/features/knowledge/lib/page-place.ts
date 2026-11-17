import type { Box } from './pdf-raster'
import type { PageRegion } from './page-region'

export interface PlaceDocument {
  id: string | null
  name: string
  shelf: 'stored' | 'base'
}

export interface PagePlace {
  document: PlaceDocument
  page: number
  frame: 'page' | 'image'
  region: readonly number[] | null
  point?: readonly number[] | null
  imageIndex?: number | null
  revisionId?: string | null
  label?: string | null
}

export const CLIP_ASPECT = 3 / 2
const BOX_MARGIN = 0.35
const PAGE_MARGIN = 0.04
const POINT_HALF = 0.015

const isShare = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

function corners(region: readonly number[] | null | undefined): [number, number, number, number] | null {
  if (!region || region.length !== 4 || !region.every(isShare)) return null
  const [x, y, w, h] = region as [number, number, number, number]
  if (w <= 0 || h <= 0) return null
  return [x, y, Math.min(1, x + w), Math.min(1, y + h)]
}

function pointBox(point: readonly number[] | null | undefined): [number, number, number, number] | null {
  if (!point || point.length !== 2 || !point.every(isShare)) return null
  const [x, y] = point as [number, number]
  return [Math.max(0, x - POINT_HALF), Math.max(0, y - POINT_HALF), Math.min(1, x + POINT_HALF), Math.min(1, y + POINT_HALF)]
}

export function placeBox(place: PagePlace): [number, number, number, number] | null {
  if (place.frame !== 'page') return null
  return corners(place.region) ?? pointBox(place.point)
}

export function placeRegions(place: PagePlace): PageRegion[] {
  const box = placeBox(place)
  if (!box) return []
  const label = place.label?.trim()
  return [{ box, ...(label ? { label } : {}) }]
}

function span(start: number, length: number, total: number): [number, number] {
  const size = Math.min(length, total)
  return [Math.min(Math.max(0, start), total - size), size]
}

export function placeClip(
  page: { width: number; height: number },
  box: readonly [number, number, number, number] | null
): { crop: Box; mark: Box | null } {
  const whole = { crop: { x: 0, y: 0, width: page.width, height: page.height }, mark: null }
  if (!box || page.width <= 0 || page.height <= 0) return whole
  const [x0, y0, x1, y1] = box
  const area = { x: x0 * page.width, y: y0 * page.height, width: (x1 - x0) * page.width, height: (y1 - y0) * page.height }
  if (area.width <= 0 || area.height <= 0) return whole

  const marginX = Math.max(area.width * BOX_MARGIN, page.width * PAGE_MARGIN)
  const marginY = Math.max(area.height * BOX_MARGIN, page.height * PAGE_MARGIN)
  let width = area.width + 2 * marginX
  let height = area.height + 2 * marginY
  if (width / height < CLIP_ASPECT) width = height * CLIP_ASPECT
  else height = width / CLIP_ASPECT
  const centreX = area.x + area.width / 2
  const centreY = area.y + area.height / 2
  const [x, w] = span(centreX - width / 2, width, page.width)
  const [y, h] = span(centreY - height / 2, height, page.height)
  return {
    crop: { x, y, width: w, height: h },
    mark: { x: area.x - x, y: area.y - y, width: area.width, height: area.height },
  }
}

export function placeFileUrl(place: PagePlace): string | null {
  const { document, revisionId } = place
  if (document.shelf === 'base') return `/api/knowledge-base/documents/${encodeURIComponent(document.name)}`
  if (!document.id) return null
  const id = encodeURIComponent(document.id)
  return revisionId ? `/api/documents/${id}/file?versionId=${encodeURIComponent(revisionId)}` : `/api/documents/${id}/file`
}

export function placePreviewUrl(place: PagePlace): string | null {
  if (place.document.shelf !== 'stored' || !place.document.id) return null
  return `/api/documents/${encodeURIComponent(place.document.id)}/preview`
}
