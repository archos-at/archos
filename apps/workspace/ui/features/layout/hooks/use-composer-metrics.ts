'use client'

import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import type { Transition } from 'motion/react'
import { springGlide } from '@/components/motion'
import { useInputSinceMount } from '@/components/motion/use-input-since-mount'

const COMPOSER_GAP_PX = 32

const GREETING_ABOVE_MIDDLE_PX = 70

export const WELCOME_OFFSET_FALLBACK = `round(nearest, calc(50cqh + ${GREETING_ABOVE_MIDDLE_PX}px), 1px)`

const REST_LIFT_FALLBACK = `var(--composer-rest-lift, round(nearest, min(0px, calc(100% - ${GREETING_ABOVE_MIDDLE_PX - COMPOSER_GAP_PX}px - 50cqh)), 1px))`

export const COMPOSER_ON_PHONE_FLOOR = 'max-md:[--composer-rest-lift:0px]'

export const restGeometry = (column: number, composer: number, onFloor = false): { y: number; welcomeOffset: number } => {
  const greetingLine = onFloor ? 0 : column / 2 + GREETING_ABOVE_MIDDLE_PX
  return {
    y: Math.round(Math.min(0, composer + COMPOSER_GAP_PX - greetingLine)),
    welcomeOffset: Math.round(Math.max(greetingLine, composer + COMPOSER_GAP_PX)),
  }
}

const heightOf = (node: Element): number => node.getBoundingClientRect().height

export interface ComposerMetrics {
  composerRef: (node: HTMLDivElement | null) => void
  columnVars: CSSProperties
  composerStyle: CSSProperties
  composerMotion: {
    initial: false
    animate: { y: number | string }
    transition: Transition
    onAnimationComplete: () => void
  }
}

export function useComposerMetrics(
  isThreadEmpty: boolean,
  keyboardUp = false,
  { predicted = false, phone = false }: { predicted?: boolean; phone?: boolean | null } = {}
): ComposerMetrics {
  const [composerHeight, setComposerHeight] = useState<number | null>(null)
  const [columnHeight, setColumnHeight] = useState<number | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const composerRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return
    const column = node.offsetParent
    let published = { composer: -1, column: -1 }
    const read = () => ({ composer: heightOf(node), column: column ? heightOf(column) : -1 })
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

  const rest = measured ? restGeometry(columnHeight, composerHeight, keyboardUp) : null
  const restY = keyboardUp || phone === true ? 0 : rest && phone === false ? rest.y : REST_LIFT_FALLBACK
  const composerY = isThreadEmpty ? restY : 0

  const welcomeOffsetRef = useRef<number | null>(null)
  if (isThreadEmpty && rest) {
    welcomeOffsetRef.current = rest.welcomeOffset
  }
  const welcomeOffset = welcomeOffsetRef.current

  const readerActed = useInputSinceMount()
  const [wasEmpty, setWasEmpty] = useState(isThreadEmpty)
  const [wasPredicted, setWasPredicted] = useState(predicted)
  const [travelling, setTravelling] = useState(false)
  if (wasEmpty !== isThreadEmpty) {
    setWasEmpty(isThreadEmpty)
    setTravelling(readerActed.current || wasPredicted)
  }
  if (wasPredicted !== predicted) setWasPredicted(predicted)

  return {
    composerRef,
    composerMotion: {
      initial: false as const,
      animate: { y: composerY === 0 ? 0 : composerY },
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
