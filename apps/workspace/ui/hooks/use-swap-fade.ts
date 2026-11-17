'use client'

import { useLayoutEffect, useRef, type RefObject } from 'react'
import { animate } from 'motion/react'
import { motionInstant, motionQuick, useMotionToken } from '@/components/motion'

export function useSwapFade(frameRef: RefObject<HTMLElement | null>, swapKey: unknown): void {
  const transition = useMotionToken(motionQuick)
  const previousKey = useRef(swapKey)

  useLayoutEffect(() => {
    if (Object.is(previousKey.current, swapKey)) return
    previousKey.current = swapKey
    const frame = frameRef.current
    if (!frame || transition === motionInstant) return
    const controls = animate(frame, { opacity: [0, 1] }, transition)
    return () => {
      controls.stop()
      frame.style.opacity = ''
    }
  }, [swapKey, frameRef, transition])
}
