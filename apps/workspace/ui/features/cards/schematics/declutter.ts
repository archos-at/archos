export interface LabelBox {
  left: number
  right: number
  top: number
  bottom: number
  movable: boolean
}

export interface LabelNudge {
  dx: number
  dy: number
}

interface Options {
  gap?: number
  maxShift?: number
}

const PASSES = 6
const TOLERANCE = 0.75

const overlap = (a: LabelBox, b: LabelBox): { x: number; y: number } => ({
  x: Math.min(a.right, b.right) - Math.max(a.left, b.left),
  y: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
})

export function declutterLabels(
  boxes: readonly LabelBox[],
  bounds: { left: number; right: number },
  { gap = 1, maxShift = 14 }: Options = {}
): LabelNudge[] {
  const moved = boxes.map((box) => ({ ...box }))
  const nudges: LabelNudge[] = boxes.map(() => ({ dx: 0, dy: 0 }))

  const shiftBy = (index: number, dx: number, dy: number): void => {
    const nudge = nudges[index]
    const box = moved[index]
    const nextDx = Math.max(-maxShift * 4, Math.min(maxShift * 4, nudge.dx + dx))
    const nextDy = Math.max(-maxShift, Math.min(maxShift, nudge.dy + dy))
    const appliedX = nextDx - nudge.dx
    const appliedY = nextDy - nudge.dy
    box.left += appliedX
    box.right += appliedX
    box.top += appliedY
    box.bottom += appliedY
    nudge.dx = nextDx
    nudge.dy = nextDy
  }

  moved.forEach((box, index) => {
    if (!box.movable) return
    const width = box.right - box.left
    if (width > bounds.right - bounds.left) return
    if (box.left < bounds.left) shiftBy(index, bounds.left - box.left, 0)
    else if (box.right > bounds.right) shiftBy(index, bounds.right - box.right, 0)
  })

  for (let pass = 0; pass < PASSES; pass += 1) {
    let changed = false
    const order = moved.map((_, index) => index).sort((a, b) => moved[a].top - moved[b].top)
    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const upper = order[i]
        const lower = order[j]
        const o = overlap(moved[upper], moved[lower])
        if (o.x <= TOLERANCE || o.y <= TOLERANCE) continue
        const push = o.y + gap
        if (moved[lower].movable) {
          shiftBy(lower, 0, push)
          changed = true
        } else if (moved[upper].movable) {
          shiftBy(upper, 0, -push)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return nudges
}
