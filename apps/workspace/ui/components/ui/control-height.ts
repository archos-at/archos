export const CONTROL_HEIGHT = {
  default: 'h-9 pointer-coarse:h-11',
  sm: 'h-8 pointer-coarse:h-11',
} as const

export type ControlSize = keyof typeof CONTROL_HEIGHT
