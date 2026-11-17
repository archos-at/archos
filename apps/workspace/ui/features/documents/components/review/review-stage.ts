import { createContext, useContext, useLayoutEffect, type RefObject } from 'react'

export interface Band {
  top: number
  bottom: number
}

export const STAGE_FOOT = { pointer: 100, touch: 176 } as const

export const STAGE_HEAD = 12

export type StageBounds = () => Band | null

export const ReviewStageContext = createContext<StageBounds | null>(null)

export const MIN_CARD_HEIGHT = 200

const HAIRLINE_KEEP = 28

export interface CardFit {
  shift: number
  maxHeight: number
}

export function fitCard(top: number, height: number, stage: Band, side: boolean): CardFit {
  const room = Math.max(0, stage.bottom - stage.top)
  if (!side) return { shift: 0, maxHeight: Math.min(room, Math.max(MIN_CARD_HEIGHT, stage.bottom - top)) }
  const overflow = top + Math.min(height, room) - stage.bottom
  return { shift: Math.max(0, Math.min(overflow, top - stage.top, height - HAIRLINE_KEEP)), maxHeight: room }
}

export function covers(
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number }
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

export function useCardFit(ref: RefObject<HTMLElement | null>, placement: 'right' | 'left' | 'below' | 'detached' | null): void {
  const stage = useContext(ReviewStageContext)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !stage || !placement) return
    const side = placement === 'right' || placement === 'left'
    let frame = 0
    const measure = () => {
      frame = 0
      const bounds = stage()
      if (!bounds) return
      const shifted = Number.parseFloat(node.style.getPropertyValue('--card-shift')) || 0
      const fit = fitCard(node.getBoundingClientRect().top + shifted, node.offsetHeight, bounds, side)
      node.style.setProperty('--card-max-height', `${fit.maxHeight}px`)
      node.style.setProperty('--card-shift', `${fit.shift}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(node)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, stage, placement])
}
