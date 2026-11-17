'use client'

import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import type { Transition } from 'motion/react'
import { springGlide } from '@/components/motion'

const COMPOSER_GAP_PX = 32

const GREETING_H_PX = 28

export const WELCOME_OFFSET_FALLBACK = '13rem'

export interface ComposerMetrics {
  composerRef: (node: HTMLDivElement | null) => void
  columnVars: CSSProperties
  composerStyle: CSSProperties
  composerMotion: {
    initial: false
    animate: { y: number }
    transition: Transition
    onAnimationComplete: () => void
  }
}

export function useComposerMetrics(isThreadEmpty: boolean): ComposerMetrics {
  const [composerHeight, setComposerHeight] = useState<number | null>(null)
  const [columnHeight, setColumnHeight] = useState<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const composerRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const column = node.offsetParent
    let published = { composer: -1, column: -1 }
    const read = () => ({ composer: node.offsetHeight, column: column?.clientHeight ?? -1 })
    const update = (next: typeof published) => {
      published = next
      setComposerHeight(next.composer)
      if (column) setColumnHeight(next.column)
    }
    update(read())
    const ro = new ResizeObserver(() => {
      const next = read()
      if (
        Math.abs(next.composer - published.composer) < 1 &&
        Math.abs(next.column - published.column) < 1
      ) {
        return
      }
      flushSync(() => update(next))
    })
    ro.observe(node)
    if (column) ro.observe(column)
    observerRef.current = ro
  }, [])

  const measured = composerHeight != null && columnHeight != null

  const restLift = measured
    ? Math.max(0, Math.round((columnHeight - composerHeight - COMPOSER_GAP_PX - GREETING_H_PX) / 2))
    : 0
  const composerLift = isThreadEmpty ? restLift : 0

  const welcomeOffsetRef = useRef<number | null>(null)
  if (isThreadEmpty && measured) {
    welcomeOffsetRef.current = composerHeight + restLift + COMPOSER_GAP_PX
  }
  const welcomeOffset = welcomeOffsetRef.current

  const [wasEmpty, setWasEmpty] = useState(isThreadEmpty)
  const [travelling, setTravelling] = useState(false)
  if (wasEmpty !== isThreadEmpty) {
    setWasEmpty(isThreadEmpty)
    setTravelling(true)
  }

  return {
    composerRef,
    composerMotion: {
      initial: false as const,
      animate: { y: composerLift === 0 ? 0 : -composerLift },
      transition: travelling ? springGlide : { duration: 0 },
      onAnimationComplete: () => setTravelling(false),
    },
    columnVars: {
      ...(composerHeight != null ? { ['--composer-h' as string]: `${composerHeight}px` } : {}),
      ...(welcomeOffset != null ? { ['--welcome-offset' as string]: `${welcomeOffset}px` } : {}),
    },
    composerStyle: { bottom: 0 },
  }
}
