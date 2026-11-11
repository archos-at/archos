'use client'

/**
 * The citation style of the office's country, read once per page from
 * `GET /api/citations/style`. Until it answers, and while the country has none
 * released, lines are written in the fallback style (FALLBACK, delete after
 * rollover, with `FALLBACK_CITATION_STYLES`).
 */

import { useEffect, useState } from 'react'
import { citationStyleSchema, FALLBACK_CITATION_STYLES, type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'

let pending: Promise<CitationStylePayload | null> | null = null

const load = (): Promise<CitationStylePayload | null> =>
  (pending ??= fetch('/api/citations/style')
    .then((response) => (response.ok ? (response.json() as Promise<{ style?: unknown }>) : null))
    .then((body) => {
      // A refused read (`body` null) is asked again by the next reader; a read that says none is released holds.
      if (!body) pending = null
      const parsed = citationStyleSchema.safeParse(body?.style)
      return parsed.success ? parsed.data : null
    })
    .catch(() => {
      pending = null // a failed read is asked again by the next reader
      return null
    }))

export function useCitationStyles(): CitationStylePayload {
  const [styles, setStyles] = useState(FALLBACK_CITATION_STYLES)
  useEffect(() => {
    let live = true
    void load().then((released) => {
      if (live && released) setStyles(released)
    })
    return () => {
      live = false
    }
  }, [])
  return styles
}
