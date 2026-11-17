import { ColumnSlot } from './flow-node-data'

const MIN_COL_W = 172

const MAX_COL_W = 236

export const GROUPED_MAX_W = 420

const COL_GAP = 14

export const ROW_GAP = 40

export const PAD = 24

const MIN_CONTENT_W = 220

export const FALLBACK_W = 680

export function measuredFanWidth(previous: number, clientWidth: number): number {
  return clientWidth > 0 ? clientWidth : previous
}

export interface FanLayout {
  columns: number[][]
  colW: number
  gap: number
  fanX: number
  contentW: number
  grouped: boolean
}

export function planFan(width: number, cardCount: number): FanLayout {
  const contentW = Math.max(MIN_CONTENT_W, Math.floor(width) || MIN_CONTENT_W)
  const grouped = contentW <= GROUPED_MAX_W
  if (cardCount <= 0) {
    return { columns: [], colW: contentW, gap: COL_GAP, fanX: 0, contentW, grouped: false }
  }
  const capacity = grouped
    ? 1
    : Math.max(1, Math.floor((contentW + COL_GAP) / (MIN_COL_W + COL_GAP)))
  const count = Math.min(cardCount, capacity)
  const colW = grouped
    ? contentW
    : Math.min(MAX_COL_W, Math.floor((contentW - (count - 1) * COL_GAP) / count))
  const fanW = count * colW + (count - 1) * COL_GAP
  const fanX = Math.max(0, Math.round((contentW - fanW) / 2))

  const base = Math.floor(cardCount / count)
  const remainder = cardCount % count
  const columns: number[][] = []
  let next = 0
  for (let c = 0; c < count; c++) {
    const size = base + (c < remainder ? 1 : 0)
    columns.push(Array.from({ length: size }, () => next++))
  }
  return { columns, colW, gap: COL_GAP, fanX, contentW, grouped }
}

export function packSlots(width: number, slots: readonly ColumnSlot[]): FanLayout {
  const last = slots.at(-1)
  const openFold = last?.type === 'fold' && last.expanded
  if (!openFold) return planFan(width, slots.length)
  const packed = planFan(width, slots.length - 1)
  const columns = packed.columns.map((column, i, all) =>
    i === all.length - 1 ? [...column, slots.length - 1] : column
  )
  return { ...packed, columns }
}
