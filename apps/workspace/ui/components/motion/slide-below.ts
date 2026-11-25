'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { asWebAnimation, motionDeliberateEntrance, motionInstant, motionQuick, useMotionToken } from './index'

type Placement = { top: number; height: number }

type Placements = Map<Element, Placement>

const OVERHANG = 8

const readPlacements = (list: HTMLElement): Placements => {
  const placements: Placements = new Map()
  for (const child of list.children) {
    if (child instanceof HTMLElement) {
      placements.set(child, { top: child.offsetTop, height: child.offsetHeight })
    }
  }
  return placements
}

const translateYOf = (element: Element): number => {
  const { translate = '' } = getComputedStyle(element)
  const [, y] = translate.split(' ')
  return Number.parseFloat(y ?? '') || 0
}

const clippedBottomOf = (element: Element): number => {
  const { clipPath = '' } = getComputedStyle(element)
  const inset = /^inset\(([^)]*)\)/.exec(clipPath)?.[1]
  return Math.max(0, Number.parseFloat(inset?.split(' ')[2] ?? '') || 0)
}

const running = new WeakMap<Element, { slide?: Animation; reveal?: Animation }>()

const play = (
  element: Element,
  kind: 'slide' | 'reveal',
  keyframes: Keyframe[],
  timing: KeyframeAnimationOptions
) => {
  const own = running.get(element) ?? {}
  own[kind]?.cancel()
  own[kind] = element.animate(keyframes, timing)
  running.set(element, own)
}

const edge = (bottom: number) => `inset(-${OVERHANG}px -${OVERHANG}px ${bottom}px -${OVERHANG}px)`

const reveal = (element: Element, hidden: number, timing: KeyframeAnimationOptions) => {
  const bottom = clippedBottomOf(element) + hidden
  play(element, 'reveal', [{ clipPath: edge(bottom) }, { clipPath: edge(0) }], timing)
}

const STILL: KeyframeAnimationOptions = { duration: Number(asWebAnimation(motionQuick).duration) * 2, easing: 'linear' }

const moveUnseen = (element: Element, moved: number) => {
  const from = `0 ${translateYOf(element) - moved}px`
  play(
    element,
    'slide',
    [
      { translate: from, opacity: 1, offset: 0 },
      { translate: from, opacity: 0, offset: 0.5 },
      { translate: '0 0', opacity: 0, offset: 0.5 },
      { translate: '0 0', opacity: 1, offset: 1 },
    ],
    STILL
  )
}

const uncoverUnseen = (element: Element, hidden: number) => {
  const bottom = clippedBottomOf(element) + hidden
  play(
    element,
    'reveal',
    [
      { clipPath: edge(bottom), offset: 0 },
      { clipPath: edge(bottom), offset: 0.5 },
      { clipPath: edge(0), offset: 0.5 },
      { clipPath: edge(0), offset: 1 },
    ],
    STILL
  )
}

export const SlideBelowScope = createContext<(() => void) | null>(null)

export function useSlideBelow(
  listRef: RefObject<HTMLElement | null>,
  clipRef?: RefObject<HTMLElement | null>
): () => void {
  const enclosing = useContext(SlideBelowScope)
  const transition = useMotionToken(motionDeliberateEntrance)
  const placements = useRef<Placements | null>(null)
  const height = useRef(0)
  const watched = useRef<{ list: HTMLElement; observer: ResizeObserver | null } | null>(null)

  useEffect(() => () => watched.current?.observer?.disconnect(), [])

  const settle = () => {
    const list = listRef.current
    if (!list) return
    if (watched.current?.list !== list) {
      watched.current?.observer?.disconnect()
      placements.current = null
      const observer =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              placements.current = readPlacements(list)
              height.current = list.offsetHeight
            })
      observer?.observe(list)
      watched.current = { list, observer }
    }
    const next = readPlacements(list)
    const previous = placements.current
    const grew = list.offsetHeight - height.current
    placements.current = next
    height.current = list.offsetHeight
    for (const child of next.keys()) watched.current.observer?.observe(child)
    if (!previous) return

    const still = transition === motionInstant
    const timing = asWebAnimation(transition)
    const uncover = (element: Element, hidden: number) =>
      still ? uncoverUnseen(element, hidden) : reveal(element, hidden, timing)
    for (const [child, now] of next) {
      const before = previous.get(child)
      if (!before) {
        if (previous.size > 0 && now.height >= 1) uncover(child, now.height)
        continue
      }
      const moved = now.top - before.top
      if (Math.abs(moved) >= 1 && still) moveUnseen(child, moved)
      else if (Math.abs(moved) >= 1) {
        const from = translateYOf(child) - moved
        play(child, 'slide', [{ translate: `0 ${from}px` }, { translate: '0 0' }], timing)
      }
      if (now.height - before.height >= 1) uncover(child, now.height - before.height)
    }
    const clip = clipRef?.current
    if (clip && grew >= 1) uncover(clip, grew)
  }
  const latest = useRef(settle)
  useLayoutEffect(() => {
    latest.current = settle
    settle()
    enclosing?.()
  })
  return useCallback(() => latest.current(), [])
}
