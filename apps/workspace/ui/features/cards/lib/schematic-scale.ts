export const fitScale = (realW: number, realH: number, boxW: number, boxH: number): number =>
  Math.min(boxW / Math.max(realW, 1e-6), boxH / Math.max(realH, 1e-6))

export const MIN_LABEL_PX = 10
export const MAX_LABEL_GROWTH = 2

export const legibleLabelSize = (size: number, scale: number | null): number => {
  if (!scale || scale <= 0 || size * scale >= MIN_LABEL_PX) return size
  return Math.min(MIN_LABEL_PX / scale, size * MAX_LABEL_GROWTH)
}
