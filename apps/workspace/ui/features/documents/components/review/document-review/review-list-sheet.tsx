'use client'

import { type Dispatch, type JSX, type ReactNode, type SetStateAction } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentReview as ReviewState } from '../../../hooks/use-document-review'
import { ReviewPanel, type CheckFixed, type OpenMark } from '../review-panel'

export function ReviewListSheet({
  review,
  documentName,
  listOpen,
  setListOpen,
  exportMenu,
  openFromList,
  walkProposals,
  checkFixed,
}: {
  review: ReviewState
  documentName: string
  listOpen: boolean
  setListOpen: Dispatch<SetStateAction<boolean>>
  exportMenu: ReactNode
  openFromList: OpenMark
  walkProposals: () => void
  checkFixed: CheckFixed | undefined
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <Sheet open={listOpen} onOpenChange={setListOpen}>
      <SheetContent
        side="bottom"
        closeLabel={t('review.close')}
        data-testid="review-list-sheet"
        className="flex h-[70dvh] flex-col gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-xl"
      >
        <SheetHeader className="flex-row items-center gap-2 px-4 pt-4 pr-14 pb-0">
          <SheetTitle className="text-base">{t('annotations.section')}</SheetTitle>
          <SheetDescription className="sr-only">{documentName}</SheetDescription>
          {exportMenu && <div className="ml-auto">{exportMenu}</div>}
        </SheetHeader>
        <ReviewPanel
          review={review}
          presentation="sheet"
          onOpen={(annotation, byKeyboard) => {
            setListOpen(false)
            openFromList(annotation, byKeyboard)
          }}
          onWalkProposals={() => {
            setListOpen(false)
            walkProposals()
          }}
          onCheckFixed={checkFixed}
        />
      </SheetContent>
    </Sheet>
  )
}
