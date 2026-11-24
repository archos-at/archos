import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useCallback, useEffect, useLayoutEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import type { ContentTransform } from '../lib/content-transform'
import { anchoredTransform, clampZoom } from '../lib/pdf-zoom'
import { useZoomGestures, type ZoomCommit } from '../lib/use-zoom-gestures'
import {
  DETAIL_SETTLE_MS,
  RERASTER_DELAY_MS,
  pageShare,
  prefersReducedMotion,
  type ViewSignal,
  type ZoomAnchor,
} from '../components/pdf-document-view-helpers'

export interface PdfZoomArgs {
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  pageRefs: RefObject<Map<number, HTMLDivElement>>
  anchorRef: RefObject<ZoomAnchor | null>
  zoomRef: RefObject<number>
  maxZoomRef: RefObject<number>
  stackTransform: ContentTransform
  viewSignal: ViewSignal
  doc: PDFDocumentProxy | null
  zoom: number
  setZoom: Dispatch<SetStateAction<number>>
  maxZoom: number
  targetWidth: number
}

export function usePdfZoom({
  scrollRef,
  contentRef,
  pageRefs,
  anchorRef,
  zoomRef,
  maxZoomRef,
  stackTransform,
  viewSignal,
  doc,
  zoom,
  setZoom,
  maxZoom,
  targetWidth,
}: PdfZoomArgs) {
  const setContentNode = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      stackTransform.attach(node)
    },
    [stackTransform],
  )

  const applyAnchor = useCallback(() => {
    const anchor = anchorRef.current
    const frameNode = scrollRef.current
    const content = contentRef.current
    if (!anchor || !frameNode || !content) {
      stackTransform.release()
      return
    }
    anchorRef.current = null
    stackTransform.clear()
    const box = frameNode.getBoundingClientRect()
    const before = content.getBoundingClientRect()
    const pageNode = anchor.page === null ? undefined : pageRefs.current.get(anchor.page)
    const point = pageNode
      ? {
          x: pageNode.offsetLeft + anchor.fx * pageNode.offsetWidth,
          y: pageNode.offsetTop + anchor.fy * pageNode.offsetHeight,
        }
      : { x: anchor.contentX * anchor.ratio, y: anchor.contentY * anchor.ratio }
    frameNode.scrollTop = before.top - box.top + frameNode.scrollTop + point.y - anchor.y
    frameNode.scrollLeft = before.left - box.left + frameNode.scrollLeft + point.x - anchor.x
    const after = content.getBoundingClientRect()
    stackTransform.settle(
      anchoredTransform({
        scale: anchor.shown / zoomRef.current,
        point,
        origin: { x: after.left, y: after.top },
        at: { x: box.left + anchor.x, y: box.top + anchor.y },
      }),
      { animate: !prefersReducedMotion() },
    )
  }, [stackTransform])

  const commitZoom = useCallback(
    (commit: ZoomCommit) => {
      const frameNode = scrollRef.current
      const target = clampZoom(commit.target, maxZoomRef.current)
      const drawn = zoomRef.current
      if (frameNode) {
        const box = frameNode.getBoundingClientRect()
        const pending = anchorRef.current
        anchorRef.current = pending
          ? { ...pending, x: commit.clientX - box.left, y: commit.clientY - box.top, ratio: pending.ratio * (target / drawn) }
          : {
              x: commit.clientX - box.left,
              y: commit.clientY - box.top,
              ...pageShare(pageRefs.current, commit.contentX, commit.contentY),
              contentX: commit.contentX,
              contentY: commit.contentY,
              ratio: target / drawn,
              shown: commit.shown,
            }
      }
      if (Math.abs(target - drawn) < 1e-4) {
        applyAnchor()
        return
      }
      zoomRef.current = target
      setZoom(target)
    },
    [applyAnchor],
  )

  useLayoutEffect(() => {
    applyAnchor()
  }, [targetWidth, applyAnchor])

  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const frameNode = scrollRef.current
      const content = contentRef.current
      if (!frameNode || !content) {
        zoomRef.current = clampZoom(next, maxZoomRef.current)
        setZoom(zoomRef.current)
        return
      }
      stackTransform.finish()
      const box = frameNode.getBoundingClientRect()
      const stack = content.getBoundingClientRect()
      const x = clientX ?? box.left + frameNode.clientWidth / 2
      const y = clientY ?? box.top + frameNode.clientHeight / 2
      commitZoom({
        target: next,
        shown: zoomRef.current,
        clientX: x,
        clientY: y,
        contentX: x - stack.left,
        contentY: y - stack.top,
      })
    },
    [commitZoom, stackTransform],
  )

  const fitAgain = useCallback(() => zoomTo(1), [zoomTo])

  useZoomGestures(scrollRef, {
    enabled: Boolean(doc),
    contentRef,
    transform: stackTransform,
    zoom,
    maxZoom,
    onCommit: commitZoom,
  })

  useEffect(() => {
    const frameNode = scrollRef.current
    if (!frameNode || !doc) return
    let timer: number | null = null
    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        if (!stackTransform.active) viewSignal.emit()
      }, DETAIL_SETTLE_MS)
    }
    frameNode.addEventListener('scroll', schedule, { passive: true })
    const stopRest = stackTransform.onRest(schedule)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      frameNode.removeEventListener('scroll', schedule)
      stopRest()
    }
  }, [doc, stackTransform, viewSignal])

  useEffect(() => {
    if (!doc || targetWidth <= 0) return
    const timer = window.setTimeout(() => {
      if (!stackTransform.active) viewSignal.emit()
    }, DETAIL_SETTLE_MS + RERASTER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [doc, targetWidth, stackTransform, viewSignal])

  return { setContentNode, applyAnchor, commitZoom, zoomTo, fitAgain }
}
