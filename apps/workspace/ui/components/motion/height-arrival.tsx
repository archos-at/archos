'use client'

import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { motionDeliberateEntrance, motionInstant, motionQuickExit, useMotionToken } from './index'

export const HeightArrival = ({
  children,
  className,
  testId,
  as = 'div',
}: {
  children: ReactNode
  className?: string
  testId?: string
  as?: 'div' | 'li'
}) => {
  const Frame = as === 'li' ? motion.li : motion.div
  const enter = useMotionToken(motionDeliberateEntrance)
  const exit = useMotionToken(motionQuickExit)
  const [animating, setAnimating] = useState(false)
  return (
    // eslint-disable-next-line grid/motion-vocabulary -- the shared arrival primitive: a block arriving below the reading point
    <Frame
      data-testid={testId}
      className={cn('flex flex-col', animating && 'overflow-hidden', className)}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0, transition: exit }}
      transition={enter}
      onAnimationStart={() => setAnimating(true)}
      onAnimationComplete={() => setAnimating(false)}
    >
      {children}
    </Frame>
  )
}

export const HeightExpand = ({
  open,
  instant = false,
  children,
  className,
  testId,
}: {
  open: boolean
  instant?: boolean
  children: ReactNode
  className?: string
  testId?: string
}) => {
  const enter = useMotionToken(motionDeliberateEntrance)
  const [animating, setAnimating] = useState(false)
  return (
    // eslint-disable-next-line grid/motion-vocabulary -- the shared arrival primitive: a mounted block opening below the reading point
    <motion.div
      data-testid={testId}
      data-open={open ? 'true' : 'false'}
      className={cn('flex flex-col', (animating || !open) && 'overflow-hidden', className)}
      initial={false}
      animate={{ height: open ? 'auto' : 0 }}
      transition={instant ? motionInstant : enter}
      onAnimationStart={() => setAnimating(true)}
      onAnimationComplete={() => setAnimating(false)}
    >
      {children}
    </motion.div>
  )
}
