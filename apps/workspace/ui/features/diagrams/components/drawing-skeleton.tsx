'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { motionDeliberateEntrance, motionInstant, useMotionToken } from '@/components/motion'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const DRAWING_SKELETON_HEIGHT = 132

const SETTLE_FRAMES_MAX = 6

export function DrawingSkeleton() {
  return (
    <div
      className="flex flex-col justify-center gap-3"
      style={{ height: DRAWING_SKELETON_HEIGHT }}
      aria-hidden="true"
    >
      <Skeleton className="h-4 w-2/5 rounded-md" />
      <Skeleton className="h-4 w-3/5 rounded-md" />
      <Skeleton className="h-4 w-1/3 rounded-md" />
    </div>
  )
}

export function DrawingReveal({ drawn, children }: { drawn: boolean; children?: ReactNode }) {
  const [arrives] = useState(!drawn)
  const [standing, setStanding] = useState(drawn)
  const deliberate = useMotionToken(motionDeliberateEntrance)
  const transition = arrives ? deliberate : motionInstant
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const latestHeight = useRef<number | null>(null)
  const grows = drawn && !standing

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!grows || !content) return
    let growing = false
    let frame = 0
    let waited = 0
    const read = () => content.getBoundingClientRect().height
    const aim = (height: number) => {
      latestHeight.current = height
      setContentHeight(height)
    }
    const settle = (seen: number, still: number) => {
      frame = requestAnimationFrame(() => {
        const now = read()
        const stillNow = now === seen ? still + 1 : 0
        if (stillNow >= 2 || ++waited >= SETTLE_FRAMES_MAX) {
          growing = true
          aim(now)
        } else {
          settle(now, stillNow)
        }
      })
    }
    const report = () => {
      if (growing) return aim(read())
      cancelAnimationFrame(frame)
      settle(read(), 0)
    }
    report()
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame)
    const observer = new ResizeObserver(report)
    observer.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [grows])

  const height =
    standing && drawn
      ? 'auto'
      : drawn
        ? (contentHeight ?? DRAWING_SKELETON_HEIGHT)
        : DRAWING_SKELETON_HEIGHT
  return (
    // eslint-disable-next-line grid/motion-vocabulary -- a drawing growing from its skeleton to its own height in place, at or below the reading point; instant under reduced motion
    <motion.div
      className={cn('relative', !(standing && drawn) && 'overflow-hidden')}
      initial={false}
      animate={{ height }}
      transition={standing && drawn ? motionInstant : transition}
      onAnimationComplete={(definition) => {
        if (!drawn) {
          setStanding(false)
          return
        }
        const reached = (definition as { height?: unknown }).height
        if (typeof reached === 'number' && reached === latestHeight.current) setStanding(true)
      }}
    >
      {drawn && (
        <motion.div
          ref={contentRef}
          className="flow-root"
          initial={transition === motionInstant ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={transition}
        >
          {children}
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {!drawn && (
          <motion.div
            key="skeleton"
            className="absolute inset-x-0 top-0"
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <DrawingSkeleton />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function DrawingCaption({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const enter = useMotionToken(motionDeliberateEntrance)
  const [growing, setGrowing] = useState(false)
  return (
    // eslint-disable-next-line grid/motion-vocabulary -- a drawing's caption arriving with it, below the drawing; instant under reduced motion
    <motion.figcaption
      className={cn(growing && 'overflow-hidden', className)}
      initial={enter === motionInstant ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      transition={enter}
      onAnimationStart={() => setGrowing(true)}
      onAnimationComplete={() => setGrowing(false)}
    >
      {children}
    </motion.figcaption>
  )
}
