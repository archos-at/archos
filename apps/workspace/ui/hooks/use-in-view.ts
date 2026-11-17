'use client'

import { useEffect, useState, type RefCallback } from 'react'

export function useInView<T extends Element>({ rootMargin = '0px' }: { rootMargin?: string } = {}): [
  RefCallback<T>,
  boolean,
] {
  const [node, setNode] = useState<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(false)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1)
        if (entry) setInView(entry.isIntersecting)
      },
      { rootMargin }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, rootMargin])

  return [setNode, inView]
}
