'use client'

import type { JSX } from 'react'
import { CheckCheck, MousePointerClick } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentReview } from '../../hooks/use-document-review'

/** What an empty list says depends on why it is empty: nothing yet, nothing left, or nothing in this view. */
export function EmptyList({ review, elementMarks }: { review: DocumentReview; elementMarks: boolean }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { counts, filter, annotations, mine } = review
  // A finger has no C or R: the touch copy names the button instead.
  const touch = useMediaQuery('(pointer: coarse)')
  const allDone = filter === 'open' && !mine && annotations.length > 0 && counts.open + counts.proposed === 0
  const Icon = allDone ? CheckCheck : MousePointerClick
  const key = mine
    ? 'mine'
    : allDone
      ? 'done'
      : annotations.length === 0
        ? review.canAnnotate
          ? 'none'
          : 'readOnly'
        : filter
  return (
    <EmptyState
      variant="bare"
      size="sm"
      icon={Icon}
      className="px-6"
      data-testid="review-empty"
      title={t(`review.empty.${key}Title`)}
      description={
        key !== 'none'
          ? t(`review.empty.${key}Body`)
          : t(elementMarks ? 'review.empty.noneBodyElements' : touch ? 'review.empty.noneBodyTouch' : 'review.empty.noneBody')
      }
    />
  )
}
