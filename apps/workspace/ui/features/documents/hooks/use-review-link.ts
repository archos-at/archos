import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { backLandsOn } from '@/lib/navigation/history-step'
import {
  clearReviewParams,
  hrefWithParams,
  readReviewParams,
  setReviewParams,
  type ReviewLinkTool,
} from '../lib/open-review'
import { readDocumentLocus } from '../lib/document-locus'
import type { FileItem } from '../file-types'
import type { useDocumentReview } from './use-document-review'

export function useReviewLink({
  file,
  inChat,
  pdfInWell,
  reviewOpen,
  setReviewOpen,
  review,
}: {
  file: FileItem
  inChat: boolean
  pdfInWell: boolean
  reviewOpen: boolean
  setReviewOpen: (open: boolean) => void
  review: ReturnType<typeof useDocumentReview>
}) {
  const [reviewFocus, setReviewFocus] = useState<{ annotationId: string; key: number } | null>(null)
  const [reviewTool, setReviewTool] = useState<ReviewLinkTool | null>(null)
  const { setTool: setReviewToolInHand } = review
  const showReview = useCallback(
    (annotationId?: string | null, tool?: ReviewLinkTool | null) => {
      setReviewFocus(annotationId ? { annotationId, key: Date.now() } : null)
      setReviewTool(tool ?? null)
      if (tool) setReviewToolInHand(tool)
      setReviewOpen(true)
    },
    [setReviewToolInHand]
  )
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const reviewLink = readReviewParams(searchParams)
  const linkedLocus = readDocumentLocus(searchParams, file.id)
  const addressed = reviewLink.documentId === file.id || (reviewLink.documentId === null && inChat)
  const urlOpen = reviewLink.open && addressed && pdfInWell
  const pushedReview = useRef(false)
  const urlWasOpen = useRef(false)
  const reviewOpenRef = useRef(reviewOpen)
  useEffect(() => {
    reviewOpenRef.current = reviewOpen
  }, [reviewOpen])
  const replaceParams = useCallback(
    (params: URLSearchParams, how: 'push' | 'replace' = 'replace') => {
      const href = hrefWithParams(pathname ?? '', params)
      if (how === 'push') router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router]
  )
  useEffect(() => {
    const was = urlWasOpen.current
    urlWasOpen.current = urlOpen
    if (urlOpen && !was && !reviewOpenRef.current) showReview(reviewLink.annotationId, reviewLink.tool)
    if (!urlOpen && was && reviewOpenRef.current) {
      pushedReview.current = false
      setReviewOpen(false)
      setReviewToolInHand('select')
    }
  }, [urlOpen, reviewLink.annotationId, reviewLink.tool, showReview, setReviewToolInHand])
  const openReview = useCallback(
    (annotationId?: string, tool?: ReviewLinkTool) => {
      showReview(annotationId, tool)
      if (urlOpen || !addressed) return
      const params = setReviewParams(
        new URLSearchParams(searchParams?.toString() ?? ''),
        { documentId: file.id, annotationId, tool },
        { withDocument: false }
      )
      pushedReview.current = true
      replaceParams(params, 'push')
    },
    [showReview, urlOpen, addressed, searchParams, file.id, replaceParams]
  )

  const linkTool: ReviewLinkTool | null = review.tool === 'point' || review.tool === 'region' ? review.tool : null
  useEffect(() => {
    if (!reviewOpen || !urlOpen) return
    if (reviewLink.annotationId === review.selectedId && reviewLink.tool === linkTool) return
    if (review.load !== 'ready' && reviewLink.annotationId && !review.selectedId) return
    replaceParams(
      setReviewParams(
        new URLSearchParams(searchParams?.toString() ?? ''),
        { documentId: file.id, annotationId: review.selectedId, tool: linkTool },
        { withDocument: false }
      )
    )
  }, [reviewOpen, urlOpen, reviewLink.annotationId, reviewLink.tool, review.selectedId, review.load, linkTool, searchParams, file.id, replaceParams])
  const onReviewOpenChange = useCallback(
    (open: boolean) => {
      if (open) return openReview()
      setReviewOpen(false)
      if (!urlOpen) return
      if (pushedReview.current) {
        pushedReview.current = false
        router.back()
        return
      }
      if (reviewLink.back) {
        if (backLandsOn(reviewLink.back)) router.back()
        else router.replace(reviewLink.back, { scroll: false })
        return
      }
      replaceParams(clearReviewParams(new URLSearchParams(searchParams?.toString() ?? '')))
    },
    [openReview, urlOpen, router, replaceParams, searchParams, reviewLink.back]
  )

  return {
    addressed,
    linkTool,
    linkedLocus,
    onReviewOpenChange,
    openReview,
    pathname,
    pushedReview,
    replaceParams,
    reviewFocus,
    reviewLink,
    reviewOpenRef,
    reviewTool,
    router,
    searchParams,
    setReviewFocus,
    setReviewTool,
    setReviewToolInHand,
    showReview,
    urlOpen,
    urlWasOpen,
  }
}
