'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { animate, type AnimationPlaybackControls } from 'motion/react'
import {
  motionEntrance,
  motionInstant,
  motionQuickExit,
  useMotionToken,
} from '@/components/motion'

export function FooterDrawer<P extends string>({
  id,
  panel,
  children,
}: {
  id: string
  panel: P | null
  children: (panel: P) => ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const enter = useMotionToken(motionEntrance)
  const exit = useMotionToken(motionQuickExit)
  const instant = enter === motionInstant
  const [shown, setShown] = useState<P | null>(panel)
  const growFrom = useRef<number | null>(null)
  const running = useRef<AnimationPlaybackControls[]>([])
  const generation = useRef(0)

  const release = (frame: HTMLElement, body: HTMLElement): void => {
    frame.style.height = ''
    frame.style.overflow = ''
    body.style.opacity = ''
  }

  useLayoutEffect(() => {
    const frame = frameRef.current
    const body = bodyRef.current
    if (panel === shown) {
      if (running.current.length && frame && body) {
        generation.current++
        running.current.forEach((controls) => controls.stop())
        running.current = []
        release(frame, body)
      }
      return
    }
    const turn = ++generation.current
    running.current.forEach((controls) => controls.stop())
    running.current = []
    if (!frame || !body || instant) {
      if (frame && body) release(frame, body)
      setShown(panel)
      return
    }
    const height = frame.getBoundingClientRect().height
    if (shown === null) {
      growFrom.current = 0
      setShown(panel)
      return
    }
    frame.style.overflow = 'hidden'
    frame.style.height = `${height}px`
    if (panel === null) {
      const shrink = animate(frame, { height: [height, 0] }, exit)
      const fade = animate(body, { opacity: [Number(getComputedStyle(body).opacity), 0] }, exit)
      running.current = [shrink, fade]
      void shrink.then(() => {
        if (generation.current !== turn) return
        setShown(null)
      })
      return
    }
    const fade = animate(body, { opacity: [Number(getComputedStyle(body).opacity), 0] }, exit)
    running.current = [fade]
    void fade.then(() => {
      if (generation.current !== turn) return
      growFrom.current = height
      setShown(panel)
    })
  }, [panel, shown, instant, exit])

  useLayoutEffect(() => {
    const frame = frameRef.current
    const body = bodyRef.current
    if (!frame || !body) return
    if (shown === null) {
      release(frame, body)
      return
    }
    const from = growFrom.current
    if (from === null) return
    growFrom.current = null
    const turn = generation.current
    frame.style.height = ''
    const to = frame.offsetHeight
    frame.style.overflow = 'hidden'
    frame.style.height = `${from}px`
    const grow = animate(frame, { height: [from, to] }, enter)
    const fade = animate(body, { opacity: [0, 1] }, enter)
    running.current = [grow, fade]
    void grow.then(() => {
      if (generation.current !== turn) return
      release(frame, body)
      running.current = []
    })
  }, [shown, enter])

  return (
    <div ref={frameRef} id={id} data-panel={shown ?? undefined} data-testid="answer-footer-drawer">
      <div ref={bodyRef}>
        {shown !== null && <div className="pt-2.5 pb-1">{children(shown)}</div>}
      </div>
    </div>
  )
}
