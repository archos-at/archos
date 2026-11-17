'use client'

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { animate, type AnimationPlaybackControls } from 'motion/react'
import { motionBase, motionInstant, useMotionToken } from './index'

export function useHeightGlide(frameRef: RefObject<HTMLElement | null>, swapKey: unknown): void {
  const transition = useMotionToken(motionBase)
  const settledHeight = useRef<number | null>(null)
  const previousKey = useRef(swapKey)
  const running = useRef<AnimationPlaybackControls | null>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') return
    settledHeight.current = frame.offsetHeight
    const observer = new ResizeObserver(() => {
      if (!running.current) settledHeight.current = frame.offsetHeight
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [frameRef])

  useLayoutEffect(() => {
    if (Object.is(previousKey.current, swapKey)) return
    previousKey.current = swapKey
    const frame = frameRef.current
    if (!frame) return

    const from = running.current ? frame.getBoundingClientRect().height : settledHeight.current
    running.current?.stop()
    running.current = null
    frame.style.height = ''
    const to = frame.offsetHeight

    if (from === null || Math.abs(from - to) < 1 || transition === motionInstant) {
      frame.style.overflow = ''
      settledHeight.current = to
      return
    }

    frame.style.overflow = 'hidden'
    frame.style.height = `${from}px`
    const controls = animate(frame, { height: [`${from}px`, `${to}px`] }, transition)
    running.current = controls
    void controls.then(() => {
      if (running.current !== controls) return
      running.current = null
      frame.style.height = ''
      frame.style.overflow = ''
      settledHeight.current = frame.offsetHeight
    })
  }, [swapKey, frameRef, transition])

  useEffect(() => () => running.current?.stop(), [])
}
