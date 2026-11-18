'use client'

import type { JSX } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { CanvasAsk } from '../../../hooks/use-canvas-ask'
import type { DocumentReview as ReviewState } from '../../../hooks/use-document-review'
import { AgentAnswerCard } from '../agent-answer-card'
import type { CardPlacement } from '../thread-card'

export function ReviewCardSheet({
  review,
  documentName,
  dockOpen,
  closeCard,
  dockedAsk,
  threadCard,
}: {
  review: ReviewState
  documentName: string
  dockOpen: boolean
  closeCard: () => void
  dockedAsk: CanvasAsk | null
  threadCard: (placement: CardPlacement) => JSX.Element | null
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <Sheet open={dockOpen} modal={false} onOpenChange={(next) => !next && closeCard()}>
      <SheetContent
        side="bottom"
        closeLabel={t('review.closeThread')}
        data-testid="review-card-sheet"
        onInteractOutside={(event) => event.preventDefault()}
        className="max-h-[75dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <SheetTitle className="sr-only">{documentName}</SheetTitle>
        <SheetDescription className="sr-only">{t('annotations.section')}</SheetDescription>
        {dockedAsk ? (
          <AgentAnswerCard key={dockedAsk.id} review={review} ask={dockedAsk} placement="docked" />
        ) : (
          threadCard('docked')
        )}
      </SheetContent>
    </Sheet>
  )
}
