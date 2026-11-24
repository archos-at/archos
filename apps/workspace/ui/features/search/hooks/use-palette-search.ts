'use client'

import { useCallback, useEffect, useState } from 'react'

import type { SearchBody, SearchKind, SearchResponse, SearchScopeQuery } from '@/lib/search/search-wire'
import { openedEntry, readRecentOpened, rememberOpened, type OpenedEntry } from '../lib/recent-opened'
import { postSearch } from '../lib/search-client'
import { hitHref } from '../lib/search-hrefs'
import { findHitByHref, parseServerTiming } from '../lib/search-telemetry'
import { useSearchTracker } from './use-search-tracker'

export const PALETTE_SEARCH_DEBOUNCE_MS = 150
export const PALETTE_HITS_PER_KIND = 3

export interface PaletteSearch {
  answered: string
  response: SearchResponse | null
  loading: boolean
  failed: boolean
}

export interface PaletteSearchHandle extends PaletteSearch {
  opening: (href: string) => void
  retry: () => void
}

type Asked = PaletteSearch & { asked: string }

const IDLE: Asked = { answered: '', asked: '', response: null, loading: false, failed: false }

export function usePaletteSearch(
  text: string,
  scope: SearchScopeQuery,
  enabled: boolean,
  options: { kinds?: readonly SearchKind[]; limit?: number } = {}
): PaletteSearchHandle {
  const [state, setState] = useState<Asked>(IDLE)
  const words = text.trim()
  const scopeKey = JSON.stringify(scope)
  const kindsKey = options.kinds ? options.kinds.join(',') : ''
  const limit = options.limit ?? PALETTE_HITS_PER_KIND
  const tracker = useSearchTracker('palette')
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  useEffect(() => {
    if (!enabled) tracker.flush()
  }, [enabled, tracker])

  useEffect(() => {
    if (!enabled || words === '') {
      setState(IDLE)
      return
    }
    setState((current) => ({ ...current, loading: true, failed: false }))
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const asked = JSON.parse(scopeKey) as SearchScopeQuery
      const kinds = kindsKey ? (kindsKey.split(',') as SearchKind[]) : undefined
      const body: SearchBody = { text: words, limit, facets: false, ...(kinds ? { kinds } : {}) }
      const started = performance.now()
      let serverTiming: string | null = null
      postSearch(asked, body, controller.signal, (header) => {
        serverTiming = header
      })
        .then((response) => {
          tracker.answered({
            scope: asked,
            body,
            response,
            durationMs: performance.now() - started,
            serverTiming: parseServerTiming(serverTiming),
            view: 'list',
          })
          setState({ answered: words, asked: kindsKey, response, loading: false, failed: false })
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setState((current) => ({ ...current, loading: false, failed: true }))
        })
    }, PALETTE_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [words, scopeKey, enabled, tracker, kindsKey, limit, attempt])

  const current = state.asked === kindsKey
  const response = current ? state.response : null
  const opening = useCallback(
    (href: string) => {
      const found = response ? findHitByHref(response.sections, href, hitHref) : null
      if (found) tracker.opened(found.hit, found.rank)
      else tracker.flush()
    },
    [response, tracker]
  )
  return { answered: current ? state.answered : '', response, loading: state.loading, failed: state.failed, opening, retry }
}

export interface RecentOpened {
  entries: OpenedEntry[]
  remember: (response: SearchResponse | null, href: string) => void
}

export function useRecentOpened(open: boolean, owner: string | null): RecentOpened {
  const [entries, setEntries] = useState<OpenedEntry[]>([])

  useEffect(() => {
    if (open) setEntries(owner ? readRecentOpened(owner) : [])
  }, [open, owner])

  const remember = useCallback(
    (response: SearchResponse | null, href: string) => {
      if (!owner) return
      const found = response ? findHitByHref(response.sections, href, hitHref) : null
      const entry = found ? openedEntry(found.hit) : readRecentOpened(owner).find((known) => known.href === href)
      if (entry) setEntries(rememberOpened(owner, entry))
    },
    [owner]
  )
  return { entries, remember }
}
