'use client'

import { useCallback, useState } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'

import type { DocumentReview } from '../../hooks/use-document-review'

export const LIST_BESIDE_QUERY = '(min-width: 1024px)'

export function listHasContent(review: Pick<DocumentReview, 'annotations' | 'carried' | 'load'>): boolean {
  if (review.load === 'error') return true
  return review.annotations.length > 0 || review.carried.length > 0
}

export function useReviewList(review: Pick<DocumentReview, 'annotations' | 'carried' | 'load'>) {
  const beside = useMediaQuery(LIST_BESIDE_QUERY)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [chosen, setChosen] = useState<boolean | null>(null)
  const columnOpen = chosen ?? listHasContent(review)
  const toggle = useCallback(() => {
    if (beside) setChosen(!columnOpen)
    else setSheetOpen(true)
  }, [beside, columnOpen])
  return { beside, sheetOpen, setSheetOpen, columnOpen, expanded: beside ? columnOpen : sheetOpen, toggle }
}
