'use client'

import { useEffect, useRef, useState } from 'react'

import type { SearchHit, SearchKind } from '@/lib/search/search-wire'
import { hitHref } from '../lib/search-hrefs'
import { findHitByHref, SearchTracker, type SearchTelemetrySurface } from '../lib/search-telemetry'

export function useSearchTracker(surface: SearchTelemetrySurface): SearchTracker {
  const [tracker] = useState(() => new SearchTracker(surface))
  useEffect(() => () => tracker.flush(), [tracker])
  return tracker
}

const linkHref = (element: Element | null): string | null => {
  if (!element) return null
  const link = element.closest('a[href]') ?? element.querySelector('a[href]')
  return link?.getAttribute('href') ?? null
}

export function useOpenedHitCapture(
  tracker: SearchTracker,
  sections: Partial<Record<SearchKind, { hits: readonly SearchHit[] }>>
): void {
  const current = useRef(sections)
  useEffect(() => {
    current.current = sections
  }, [sections])

  useEffect(() => {
    const report = (href: string | null): void => {
      if (!href) return
      const found = findHitByHref(current.current, href, hitHref)
      if (found) tracker.opened(found.hit, found.rank)
    }
    const onClick = (event: MouseEvent): void => {
      if (event.button > 1 || !(event.target instanceof Element)) return
      report(event.target.closest('a[href]')?.getAttribute('href') ?? null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !(event.target instanceof Element)) return
      const active = event.target.getAttribute('aria-activedescendant')
      if (active) report(linkHref(document.getElementById(active)))
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onClick, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [tracker])
}
