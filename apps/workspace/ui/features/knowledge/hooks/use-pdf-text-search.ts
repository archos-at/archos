import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { canvasMeasure } from '../lib/canvas-measure'
import { pageTextChunks } from '../lib/pdf-text-chunks'
import { readPageTextItems } from '../lib/pdfjs-runtime'
import {
  buildPassageIndex,
  findOccurrences,
  MIN_SEARCH_QUERY,
  normalizePassage,
  type HighlightRect,
  type PassageIndex,
} from '../lib/passage-highlight'
import { SEARCH_DEBOUNCE_MS, type SearchHit } from '../components/pdf-document-view-helpers'

export interface PdfTextSearchArgs {
  doc: PDFDocumentProxy | null
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  searchedQuery: string
  setSearchedQuery: Dispatch<SetStateAction<string>>
  searchOpen: boolean
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  setSearchFocus: Dispatch<SetStateAction<number>>
  hits: SearchHit[] | null
  setHits: Dispatch<SetStateAction<SearchHit[] | null>>
  activeHit: number
  setActiveHit: Dispatch<SetStateAction<number>>
  pageIndexes: RefObject<Map<number, PassageIndex>>
  pageWidths: RefObject<Map<number, number>>
  currentPageRef: RefObject<number>
  scrollRef: RefObject<HTMLDivElement | null>
  scrollToRects: (target: { page: number; rects: HighlightRect[] }, smooth: boolean) => void
}

export function usePdfTextSearch({
  doc,
  query,
  setQuery,
  searchedQuery,
  setSearchedQuery,
  searchOpen,
  setSearchOpen,
  setSearchFocus,
  hits,
  setHits,
  activeHit,
  setActiveHit,
  pageIndexes,
  pageWidths,
  currentPageRef,
  scrollRef,
  scrollToRects,
}: PdfTextSearchArgs) {
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const queryTooShort = normalizePassage(searchedQuery).length < MIN_SEARCH_QUERY

  useEffect(() => {
    if (!doc || !searchOpen || queryTooShort) {
      setHits([])
      return
    }
    let cancelled = false
    setHits(null)
    const run = async (): Promise<void> => {
      const found: SearchHit[] = []
      for (let number = 1; number <= doc.numPages; number += 1) {
        let index = pageIndexes.current.get(number)
        if (!index) {
          const pdfPage = await doc.getPage(number)
          if (cancelled) return
          const items = await readPageTextItems(pdfPage)
          if (cancelled) return
          const unscaled = pdfPage.getViewport({ scale: 1 })
          pageWidths.current.set(number, unscaled.width)
          index = buildPassageIndex(pageTextChunks(items, unscaled.transform), canvasMeasure())
          pageIndexes.current.set(number, index)
        }
        for (const rects of findOccurrences(index, searchedQuery)) found.push({ page: number, rects })
      }
      if (cancelled) return
      setHits(found)
      const ahead = found.findIndex((entry) => entry.page >= currentPageRef.current)
      setActiveHit(ahead === -1 ? 0 : ahead)
    }
    void run().catch(() => {
      if (!cancelled) setHits([])
    })
    return () => {
      cancelled = true
    }
  }, [doc, searchOpen, searchedQuery, queryTooShort])

  const shownHit = hits?.[activeHit] ?? null
  useEffect(() => {
    if (shownHit) scrollToRects(shownHit, true)
  }, [shownHit, scrollToRects])

  const stepHit = useCallback(
    (direction: 1 | -1) => {
      if (!hits?.length) return
      setActiveHit((current) => (current + direction + hits.length) % hits.length)
    },
    [hits],
  )

  const searchMarks = useMemo(() => {
    const byPage = new Map<number, Array<{ rects: HighlightRect[]; active: boolean }>>()
    hits?.forEach((entry, index) => {
      const list = byPage.get(entry.page) ?? []
      list.push({ rects: entry.rects, active: index === activeHit })
      byPage.set(entry.page, list)
    })
    return byPage
  }, [hits, activeHit])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setSearchFocus((value) => value + 1)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
    setSearchedQuery('')
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  return { queryTooShort, shownHit, stepHit, searchMarks, openSearch, closeSearch }
}
