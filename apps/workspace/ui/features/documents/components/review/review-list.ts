'use client'

import { useCallback, useState } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'

import type { DocumentReview } from '../../hooks/use-document-review'

/** From `lg` the list is a column beside the sheet; below it, a sheet from the bottom edge behind a header button. */
export const LIST_BESIDE_QUERY = '(min-width: 1024px)'

/**
 * Whether the column has anything to say: a mark of this document (open,
 * proposed or done), the open marks of a Fassung it replaces, or that the
 * list could not be read. While the list is still on its way it has nothing yet.
 */
export function listHasContent(review: Pick<DocumentReview, 'annotations' | 'carried' | 'load'>): boolean {
  if (review.load === 'error') return true
  return review.annotations.length > 0 || review.carried.length > 0
}

/**
 * Where the review's list stands, and the one header button that shows it.
 *
 * Below `lg` the button opens the list as a sheet. From `lg` the list is a
 * column of 22rem beside the drawing, and on a document nobody has marked yet
 * that column was the loudest thing in the review: a filter, a „Für Sie"
 * toggle and an empty state, taking a third of a laptop's width from the sheet
 * the reader came to mark. So it stays folded while there is nothing in it and
 * stands up when the first mark arrives (the reader's own, a colleague's
 * through the room, or the agent's proposals). The same button folds and
 * unfolds it, and once the reader has done either, the review stops deciding
 * for them for as long as it is mounted.
 */
export function useReviewList(review: Pick<DocumentReview, 'annotations' | 'carried' | 'load'>) {
  const beside = useMediaQuery(LIST_BESIDE_QUERY)
  const [sheetOpen, setSheetOpen] = useState(false)
  /** The reader's own say over the column; null until they have used the button. */
  const [chosen, setChosen] = useState<boolean | null>(null)
  const columnOpen = chosen ?? listHasContent(review)
  const toggle = useCallback(() => {
    if (beside) setChosen(!columnOpen)
    else setSheetOpen(true)
  }, [beside, columnOpen])
  return { beside, sheetOpen, setSheetOpen, columnOpen, expanded: beside ? columnOpen : sheetOpen, toggle }
}
