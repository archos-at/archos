export interface TapRecord {
  time: number
  x: number
  y: number
  fingers: number
  moved: boolean
}

export const TAP_MAX_MS = 300
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_SLOP = 32

export type TapKind = 'none' | 'single' | 'double' | 'two-finger'

export function classifyTap(
  press: TapRecord,
  previous: TapRecord | null,
  releasedAt: number
): { kind: TapKind } {
  if (press.moved || releasedAt - press.time > TAP_MAX_MS) return { kind: 'none' }
  if (press.fingers === 2) return { kind: 'two-finger' }
  if (press.fingers !== 1) return { kind: 'none' }
  if (
    previous &&
    press.time - previous.time <= DOUBLE_TAP_MS &&
    Math.hypot(press.x - previous.x, press.y - previous.y) <= DOUBLE_TAP_SLOP
  ) {
    return { kind: 'double' }
  }
  return { kind: 'single' }
}
