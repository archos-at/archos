

import { type HighlightRect } from '../lib/passage-highlight'

import { devicePixelRatioOf, maxCanvasPixels } from '../lib/pdf-raster'

export interface PagePoint {
  page: number
  x: number
  y: number
}

export function pointOnPage(
  page: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): PagePoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return {
    page,
    x: clamp((clientX - rect.left) / rect.width),
    y: clamp((clientY - rect.top) / rect.height),
  }
}

export const MAX_SEARCH_RADIUS = 2

export function searchRadius(
  page: number | null | undefined,
  missed: readonly number[],
  numPages: number,
): number {
  if (!page || !missed.includes(page)) return 0
  const neighbours = pagesWithin(page, 1, numPages).filter((number) => number !== page)
  return neighbours.every((number) => missed.includes(number)) ? MAX_SEARCH_RADIUS : 1
}

export function pagesWithin(page: number, radius: number, numPages: number): number[] {
  const pages: number[] = []
  for (let number = page - radius; number <= page + radius; number += 1) {
    if (number >= 1 && number <= numPages) pages.push(number)
  }
  return pages
}

export const PLACEHOLDER_PAGE_ASPECT = Math.SQRT2

export const GUTTER = 24

export const TOUCH_GUTTER = 8

export const PRERENDER_MARGIN = '150% 0px'

export const PASSAGE_SCROLL_OFFSET = 0.28

export const DETAIL_SETTLE_MS = 120

export const CURRENT_PAGE_BAND = '-45% 0px -45% 0px'

export const COPIED_FEEDBACK_MS = 1600

export const MIN_QUOTE_LENGTH = 3

export interface PassageHit {
  page: number
  rects: HighlightRect[]
  fuzzy: boolean
}

export interface QuoteSelection {
  text: string
  page: number
  x: number
  y: number
}

export const FIT_PAGE_PADDING = 80

export const RERASTER_DELAY_MS = 140

export const SEARCH_DEBOUNCE_MS = 180

export const ANNOUNCE_DELAY_MS = 400

export interface SearchHit {
  page: number
  rects: HighlightRect[]
}

export interface ZoomAnchor {
  x: number
  y: number
  page: number | null
  fx: number
  fy: number
  contentX: number
  contentY: number
  ratio: number
  shown: number
}

export interface ViewSignal {
  subscribe: (listener: () => void) => () => void
  emit: () => void
}

export const createViewSignal = (): ViewSignal => {
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: () => listeners.forEach((listener) => listener()),
  }
}

export const canvasBudget = (): number =>
  maxCanvasPixels(typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false)

export const screenRatio = (): number => devicePixelRatioOf(typeof window === 'undefined' ? 1 : window.devicePixelRatio)

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export type LoadState = 'loading' | 'ready' | 'failed' | 'locked' | 'wrong-password'

export const passwordState = (error: unknown): 'locked' | 'wrong-password' | null => {
  if (typeof error !== 'object' || error === null) return null
  const { name, code } = error as { name?: unknown; code?: unknown }
  if (name !== 'PasswordException') return null
  return code === 2 ? 'wrong-password' : 'locked'
}

export const scrollBehavior = (smooth: boolean): ScrollBehavior => {
  if (!smooth) return 'auto'
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'smooth'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

export function pageShare(
  pages: ReadonlyMap<number, HTMLElement>,
  x: number,
  y: number,
): { page: number | null; fx: number; fy: number } {
  let best: { page: number; node: HTMLElement; distance: number } | null = null
  for (const [page, node] of pages) {
    if (node.offsetHeight <= 0 || node.offsetWidth <= 0) continue
    const top = node.offsetTop
    const bottom = top + node.offsetHeight
    const distance = y < top ? top - y : y > bottom ? y - bottom : 0
    if (!best || distance < best.distance) best = { page, node, distance }
    if (distance === 0) break
  }
  if (!best) return { page: null, fx: 0, fy: 0 }
  const { node } = best
  return {
    page: best.page,
    fx: (x - node.offsetLeft) / node.offsetWidth,
    fy: Math.min(1, Math.max(0, (y - node.offsetTop) / node.offsetHeight)),
  }
}
