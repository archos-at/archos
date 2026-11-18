import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { useReducedMotion } from '@/hooks/use-reduced-motion'

export const END_SLACK_PX = 24

export const atEnd = (node: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>, slack = END_SLACK_PX): boolean =>
  node.scrollHeight - node.scrollTop - node.clientHeight <= slack

export function useFollowEnd<T extends HTMLElement>(
  content: unknown
): { ref: RefObject<T | null>; onScroll: () => void; follow: () => void } {
  const ref = useRef<T | null>(null)
  const following = useRef<boolean | null>(null)
  const lastTop = useRef(0)
  const reduced = useReducedMotion()

  const onScroll = useCallback(() => {
    const node = ref.current
    if (!node) return
    if (atEnd(node)) following.current = true
    else if (node.scrollTop < lastTop.current - 1) following.current = false
    lastTop.current = node.scrollTop
  }, [])

  const follow = useCallback(() => {
    following.current = true
  }, [])

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    if (following.current === null) {
      following.current = atEnd(node)
      lastTop.current = node.scrollTop
      return
    }
    if (!following.current || atEnd(node, 1)) return
    const top = node.scrollHeight - node.clientHeight
    if (typeof node.scrollTo === 'function') node.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
    else node.scrollTop = top
  }, [content, reduced])

  useLayoutEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (following.current && !atEnd(node, 1)) node.scrollTop = node.scrollHeight - node.clientHeight
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, onScroll, follow }
}
