import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { clampPage } from '../lib/pdf-zoom'
import type { PdfDocumentViewProps } from '../components/pdf-document-view-props'
import { ANNOUNCE_DELAY_MS, CURRENT_PAGE_BAND, scrollBehavior } from '../components/pdf-document-view-helpers'

export interface PdfPageNavigationArgs {
  focus: PdfDocumentViewProps['focus']
  onViewport: PdfDocumentViewProps['onViewport']
  position: string
  doc: PDFDocumentProxy | null
  setCurrentPage: Dispatch<SetStateAction<number>>
  setAnnounced: Dispatch<SetStateAction<string>>
  scrollRef: RefObject<HTMLDivElement | null>
  pageRefs: RefObject<Map<number, HTMLDivElement>>
}

export function usePdfPageNavigation({
  focus,
  onViewport,
  position,
  doc,
  setCurrentPage,
  setAnnounced,
  scrollRef,
  pageRefs,
}: PdfPageNavigationArgs) {
  useEffect(() => {
    const frameNode = scrollRef.current
    if (!doc || !frameNode || typeof IntersectionObserver === 'undefined') return
    const inBand = new Map<number, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.page)
          if (Number.isFinite(number)) inBand.set(number, entry.isIntersecting)
        }
        const [first] = [...inBand]
          .filter(([, isInBand]) => isInBand)
          .map(([number]) => number)
          .sort((a, b) => a - b)
        if (first) setCurrentPage(first)
      },
      { root: frameNode, rootMargin: CURRENT_PAGE_BAND },
    )
    pageRefs.current.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [doc])

  useEffect(() => {
    if (!position) return
    const timer = window.setTimeout(() => setAnnounced(position), ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [position])

  const goToPage = useCallback(
    (requested: number) => {
      const frameNode = scrollRef.current
      if (!doc || !frameNode) return
      const target = clampPage(requested, doc.numPages)
      const pageNode = pageRefs.current.get(target)
      if (!pageNode) return
      const top =
        pageNode.getBoundingClientRect().top - frameNode.getBoundingClientRect().top + frameNode.scrollTop
      setCurrentPage(target)
      frameNode.scrollTo({ top: Math.max(0, top - 12), behavior: scrollBehavior(true) })
    },
    [doc],
  )

  const focusKey = focus ? `${focus.key}` : null
  const focusRef = useRef(focus)
  focusRef.current = focus
  useEffect(() => {
    const frameNode = scrollRef.current
    const focus = focusRef.current
    if (!focus || !doc || !frameNode) return
    const pageNode = pageRefs.current.get(clampPage(focus.page, doc.numPages))
    if (!pageNode) return
    const frameBox = frameNode.getBoundingClientRect()
    const pageBox = pageNode.getBoundingClientRect()
    const pointTop = pageBox.top - frameBox.top + frameNode.scrollTop + focus.y * pageBox.height
    frameNode.scrollTo({
      top: Math.max(0, pointTop - frameBox.height / 2),
      behavior: scrollBehavior(!focus.instant),
    })
  }, [focusKey, doc])

  const onViewportRef = useRef(onViewport)
  onViewportRef.current = onViewport
  const reportsViewport = onViewport !== undefined
  useEffect(() => {
    const frameNode = scrollRef.current
    if (!frameNode || !doc || !reportsViewport) return
    let frame: number | null = null
    const report = () => {
      frame = null
      const frameBox = frameNode.getBoundingClientRect()
      const middle = frameBox.top + frameBox.height / 2
      for (const [number, node] of pageRefs.current) {
        const box = node.getBoundingClientRect()
        if (box.top <= middle && box.bottom >= middle && box.height > 0) {
          onViewportRef.current?.({ page: number, y: Math.min(1, Math.max(0, (middle - box.top) / box.height)) })
          return
        }
      }
    }
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(report)
    }
    frameNode.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      frameNode.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [doc, reportsViewport])

  return { goToPage, focusKey, focusRef, onViewportRef, reportsViewport }
}
