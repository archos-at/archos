import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { passageBounds, type HighlightRect } from '../lib/passage-highlight'
import type { PdfDocumentViewProps } from '../components/pdf-document-view-props'
import {
  PASSAGE_SCROLL_OFFSET,
  scrollBehavior,
  searchRadius,
  type PassageHit,
} from '../components/pdf-document-view-helpers'

export interface PdfPassageScrollArgs {
  page: PdfDocumentViewProps['page']
  regions: PdfDocumentViewProps['regions']
  doc: PDFDocumentProxy | null
  missed: number[]
  setMissed: Dispatch<SetStateAction<number[]>>
  hit: PassageHit | null
  setHit: Dispatch<SetStateAction<PassageHit | null>>
  defaultAspect: number | null
  setPing: Dispatch<SetStateAction<number>>
  scrollRef: RefObject<HTMLDivElement | null>
  pageRefs: RefObject<Map<number, HTMLDivElement>>
  pageWidths: RefObject<Map<number, number>>
  foundRef: RefObject<boolean>
}

export function usePdfPassageScroll({
  page,
  regions,
  doc,
  missed,
  setMissed,
  hit,
  setHit,
  defaultAspect,
  setPing,
  scrollRef,
  pageRefs,
  pageWidths,
  foundRef,
}: PdfPassageScrollArgs) {
  const registerPage = useCallback((number: number, node: HTMLDivElement | null) => {
    if (node) pageRefs.current.set(number, node)
    else pageRefs.current.delete(number)
  }, [])

  const registerWidth = useCallback((number: number, width: number) => {
    pageWidths.current.set(number, width)
  }, [])

  const regionsOnPage = page && regions?.length ? regions : null

  const scrollToRegion = useCallback(
    (smooth: boolean) => {
      const frameNode = scrollRef.current
      const pageNode = page ? pageRefs.current.get(page) : undefined
      if (!frameNode || !pageNode || !regionsOnPage) return
      const top = Math.min(...regionsOnPage.map((region) => region.box[1]))
      const pageTop =
        pageNode.getBoundingClientRect().top - frameNode.getBoundingClientRect().top + frameNode.scrollTop
      const offset = pageTop + top * pageNode.clientHeight - frameNode.clientHeight * PASSAGE_SCROLL_OFFSET
      frameNode.scrollTo({ top: Math.max(0, offset), behavior: scrollBehavior(smooth) })
    },
    [page, regionsOnPage],
  )

  const scrollToRects = useCallback((target: { page: number; rects: HighlightRect[] }, smooth: boolean) => {
    const frameNode = scrollRef.current
    const pageNode = pageRefs.current.get(target.page)
    const bounds = passageBounds(target.rects)
    if (!frameNode || !pageNode || !bounds) return
    const box = frameNode.getBoundingClientRect()
    const pageBox = pageNode.getBoundingClientRect()
    const unscaled = pageWidths.current.get(target.page)
    const scale = unscaled && pageBox.width ? pageBox.width / unscaled : 1
    const pageTop = pageBox.top - box.top + frameNode.scrollTop
    const top = pageTop + bounds.y * scale - frameNode.clientHeight * PASSAGE_SCROLL_OFFSET
    const pageLeft = pageBox.left - box.left + frameNode.scrollLeft
    const left = pageLeft + (bounds.x + bounds.width / 2) * scale - frameNode.clientWidth / 2
    frameNode.scrollTo({
      top: Math.max(0, top),
      left: Math.max(0, left),
      behavior: scrollBehavior(smooth),
    })
  }, [])

  const revealPassage = useCallback(
    (target: PassageHit) => {
      setPing((previous) => previous + 1)
      scrollToRects(target, true)
    },
    [scrollToRects],
  )

  const handlePassage = useCallback(
    (found: PassageHit) => {
      if (foundRef.current) return
      foundRef.current = true
      setHit(found)
      revealPassage(found)
    },
    [revealPassage],
  )

  const handleMiss = useCallback((missedPage: number) => {
    setMissed((current) =>
      current.includes(missedPage) ? current : [...current, missedPage],
    )
  }, [])

  const radius = searchRadius(page, missed, doc?.numPages ?? 0)

  useEffect(() => {
    if (!hit || !defaultAspect) return
    const raf = requestAnimationFrame(() => scrollToRects(hit, false))
    return () => cancelAnimationFrame(raf)
  }, [hit, defaultAspect, scrollToRects])

  useEffect(() => {
    if (!doc || !page || hit) return
    if (regionsOnPage) scrollToRegion(false)
    else pageRefs.current.get(page)?.scrollIntoView({ block: 'start' })
  }, [doc, page, hit, defaultAspect, regionsOnPage, scrollToRegion])

  return { registerPage, registerWidth, regionsOnPage, scrollToRegion, scrollToRects, revealPassage, handlePassage, handleMiss, radius }
}
