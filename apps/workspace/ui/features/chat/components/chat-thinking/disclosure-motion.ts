import type { Variants } from 'motion/react'
import { motionBase, motionInstant, motionQuickExit } from '@/components/motion'
import type { CloseReason } from '../../lib/thinking-disclosure'

interface ContentExit {
  reason: CloseReason
  reducedMotion: boolean
}

export const contentVariants: Variants = {
  hidden: { opacity: 0 },
  shown: ({ reducedMotion }: ContentExit) => ({
    opacity: 1,
    height: 'auto',
    transition: reducedMotion ? motionInstant : motionBase,
  }),
  leave: ({ reason, reducedMotion }: ContentExit) => {
    if (reducedMotion) return { opacity: 0, height: 0, transition: motionInstant }
    if (reason === 'toggle') return { opacity: 0, height: 0, transition: motionQuickExit }
    return {
      opacity: 0,
      height: 0,
      transition: {
        opacity: motionQuickExit,
        height: { duration: 0, delay: motionQuickExit.duration },
      },
    }
  },
}
