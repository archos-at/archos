import type { TextChunk } from './passage-highlight'

export interface RawTextItem {
  str: string
  width: number
  height: number
  transform: number[]
  fontFamily?: string
}

export const composeTransform = (outer: number[], inner: number[]): number[] => {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = outer
  const [g = 0, h = 0, i = 0, j = 0, k = 0, l = 0] = inner
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]
}

export const textItemToChunk = (item: RawTextItem, viewportTransform: number[]): TextChunk => {
  const tx = composeTransform(viewportTransform, item.transform)
  const height = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || item.height
  const scale = Math.hypot(viewportTransform[0] ?? 0, viewportTransform[1] ?? 0) || 1
  return {
    text: item.str,
    x: tx[4] ?? 0,
    y: (tx[5] ?? 0) - height,
    width: item.width * scale,
    height,
    ...(item.fontFamily ? { fontFamily: item.fontFamily } : {}),
  }
}

export const pageTextChunks = (items: RawTextItem[], viewportTransform: number[]): TextChunk[] =>
  items
    .map((item) => textItemToChunk(item, viewportTransform))
    .filter((chunk) => chunk.text.trim().length > 0 && chunk.width > 0 && chunk.height > 0)
