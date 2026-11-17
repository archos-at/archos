'use client'

import { useEffect, useState } from 'react'
import { citationStyleSchema, type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import { FALLBACK_CITATION_STYLES } from '@/shared/citation-style-fallback'

let pending: Promise<CitationStylePayload | null> | null = null

const load = (): Promise<CitationStylePayload | null> =>
  (pending ??= fetch('/api/citations/style')
    .then((response) => (response.ok ? (response.json() as Promise<{ style?: unknown }>) : null))
    .then((body) => {
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
