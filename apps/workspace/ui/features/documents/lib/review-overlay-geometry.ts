import type { CSSProperties } from 'react'
import type { AnnotationView } from '@/lib/annotations/types'
import type { RoomPeerState } from '../hooks/use-document-room'

export const at = (x: number, y: number): CSSProperties => ({ left: `${x * 100}%`, top: `${y * 100}%` })
export const box = (x: number, y: number, w: number, h: number): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
})

export const onPage = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000

export function pointIn(element: HTMLElement, event: { clientX: number; clientY: number }) {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: onPage((event.clientX - rect.left) / rect.width), y: onPage((event.clientY - rect.top) / rect.height) }
}

export const tagFitsAbove = (y: number, height: number) => !(height > 0) || y * height >= 20

export const CARD_WIDTH = 320
export const CARD_SPAN = CARD_WIDTH + 16

export type CardSide = 'right' | 'left' | 'below'

export interface CardAnchor {
  x: number
  y: number
  placement: CardSide
}

export function placeCard(
  mark: { x: number; y: number; w: number | null; h?: number | null },
  layer: { width: number; height: number },
  span = CARD_SPAN
): CardAnchor {
  const left = mark.x
  const right = mark.x + (mark.w ?? 0)
  if (!(layer.width > 0)) {
    const flip = 1 - right < left
    return { x: flip ? left : right, y: mark.y, placement: flip ? 'left' : 'right' }
  }
  if ((1 - right) * layer.width >= span) return { x: right, y: mark.y, placement: 'right' }
  if (left * layer.width >= span) return { x: left, y: mark.y, placement: 'left' }
  const cardWidth = span - (CARD_SPAN - CARD_WIDTH)
  const x = Math.max(0, Math.min(left * layer.width, layer.width - cardWidth)) / layer.width
  return { x, y: mark.y + (mark.h ?? 0), placement: 'below' }
}

export const SELECTION_TAG_NEAR = 48

export function selectionTagged(
  selectors: readonly RoomPeerState[],
  mark: Pick<AnnotationView, 'page' | 'x' | 'y' | 'w' | 'h'>,
  layer: { width: number; height: number },
  near = SELECTION_TAG_NEAR
): RoomPeerState[] {
  if (!(layer.width > 0 && layer.height > 0)) return [...selectors]
  const x1 = mark.x + (mark.w ?? 0)
  const y1 = mark.y + (mark.h ?? 0)
  return selectors.filter((state) => {
    const cursor = state.cursor
    if (!cursor || cursor.page !== mark.page) return true
    const dx = Math.max(mark.x - cursor.x, 0, cursor.x - x1) * layer.width
    const dy = Math.max(mark.y - cursor.y, 0, cursor.y - y1) * layer.height
    return Math.hypot(dx, dy) > near
  })
}

const tagWidth = (name: string): number => name.length * 6 + 14

export function draftTagPlace(
  draft: { x: number; y: number; w: number },
  name: string,
  page: { width: number; height: number }
): 'above' | 'inside' | 'beside-right' | 'beside-left' {
  if (page.width > 0 && draft.w * page.width < tagWidth(name)) {
    return (draft.x + draft.w) * page.width + 4 + tagWidth(name) <= page.width ? 'beside-right' : 'beside-left'
  }
  return tagFitsAbove(draft.y, page.height) ? 'above' : 'inside'
}
