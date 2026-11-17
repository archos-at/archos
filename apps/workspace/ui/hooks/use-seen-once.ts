'use client'

import { useEffect, useState, type RefCallback } from 'react'

export function useSeenOnce<T extends Element>(): [RefCallback<T>, boolean] {
  const [node, setNode] = useState<T | null>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    if (seen || !node) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true)
        observer.disconnect()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, seen])

  return [setNode, seen]
}
