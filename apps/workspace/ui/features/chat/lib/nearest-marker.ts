export const NEAREST_MARKER_REACH_PX = 12

export interface MarkerBox {
  left: number
  right: number
  top: number
  bottom: number
}

export const distanceToBox = (x: number, y: number, box: MarkerBox): number => {
  const dx = Math.max(box.left - x, 0, x - box.right)
  const dy = Math.max(box.top - y, 0, y - box.bottom)
  return Math.hypot(dx, dy)
}

export const nearestMarkerIndex = (
  x: number,
  y: number,
  boxes: readonly MarkerBox[],
  reach: number = NEAREST_MARKER_REACH_PX
): number => {
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  boxes.forEach((box, index) => {
    const distance = distanceToBox(x, y, box)
    if (distance <= reach && distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}
