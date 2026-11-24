import type { Transition } from 'motion/react'

export const ROLL_OFFSET = '100%'

export interface RollMotion {
  initial: { opacity: number; y: string | number }
  animate: { opacity: number; y: number; transition: Transition }
  exit: { opacity: number; y: string; transition: Transition }
}
