'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { labelVisit, readTrail, recordVisit, writeTrail } from '@/lib/navigation/return-trail'

export function NavigationTrail(): null {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname) return
    const trail = readTrail()
    const next = recordVisit(trail, pathname)
    if (next !== trail) writeTrail(next)
  }, [pathname])

  return null
}

// The label is the one the reader was shown at visit time; never look it up later.
export function NavigationTrailLabel({ label }: { label: string }): null {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname || !label) return
    const trail = readTrail()
    const next = labelVisit(recordVisit(trail, pathname), pathname, label)
    if (next !== trail) writeTrail(next)
  }, [pathname, label])

  return null
}
