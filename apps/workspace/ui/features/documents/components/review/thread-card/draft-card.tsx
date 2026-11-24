'use client'

import { useState, type JSX } from 'react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { AnnotationKind } from '@/lib/annotations/types'
import type { FileAssignee } from '../../../file-types'
import { askRegionOf } from '../../../hooks/use-canvas-ask'
import type { DocumentReview, ReviewDraft } from '../../../hooks/use-document-review'
import { useSelfAssignee } from '../../../hooks/use-self-assignee'
import { Composer } from '../composer'
import { MeasureDraftBody } from '../measure/measure-reading'
import { KindPicker } from './kind-picker'
import { ResponsibilityRow } from './responsibility-row'
import { ReviewCard, type CardPlacement } from './review-card'

export function DraftCard({
  review,
  draft,
  placement,
  canPickAssignee,
  onSetScale,
}: {
  review: DocumentReview
  draft: ReviewDraft
  placement: CardPlacement
  canPickAssignee: boolean
  onSetScale?: (page: number) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const reading = draft.points ? review.tape.reading : null
  if (draft.points && reading) {
    const shape = draft.shape === 'line' || draft.shape === 'path' || draft.shape === 'polygon' ? draft.shape : 'line'
    return (
      <ReviewCard placement={placement} testId="review-draft" label={t('review.measure.readingLabel')}>
        <MeasureDraftBody
          reading={reading}
          onSetScale={onSetScale ? () => onSetScale(draft.page) : undefined}
          onDiscard={() => review.setDraft(null)}
          onKeep={(note) => review.create({ kind: 'hint', body: note || t(`review.measure.shape.${shape}`) })}
        />
      </ReviewCard>
    )
  }
  return <PinDraftCard review={review} draft={draft} placement={placement} canPickAssignee={canPickAssignee} />
}

function PinDraftCard({
  review,
  draft,
  placement,
  canPickAssignee,
}: {
  review: DocumentReview
  draft: ReviewDraft
  placement: CardPlacement
  canPickAssignee: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [kind, setKind] = useState<AnnotationKind>('hint')
  const [assignee, setAssignee] = useState<FileAssignee | null>(null)
  const [dueOn, setDueOn] = useState<string | null>(null)
  const self = useSelfAssignee(review)
  const { piloti } = review
  const askAgent = piloti.available
    ? (body: string) => {
        const region = askRegionOf(draft)
        if (body) piloti.ask({ text: body, region })
        else piloti.compose(region)
      }
    : undefined
  return (
    <ReviewCard placement={placement} testId="review-draft" label={t('review.draftCard')}>
      <div className="space-y-3 p-3">
        <KindPicker value={kind} onChange={setKind} />
        <Composer
          autoFocus
          testId="review-draft-body"
          placeholder={t('review.draftPlaceholder')}
          submitLabel={t('review.set')}
          onEscape={() => review.setDraft(null)}
          onAskAgent={askAgent}
          documentId={review.documentId}
          onSubmit={async (body, { mentions }) => {
            const created = await review.create({ kind, body, mentions, assigneeUserId: assignee?.userId ?? null, dueOn })
            return created?.mentions
          }}
        />
        <ResponsibilityRow
          documentId={review.documentId}
          assigneeUserId={assignee?.userId ?? null}
          assigneeName={assignee ? assignee.name || assignee.email || assignee.userId : null}
          dueOn={dueOn}
          editable
          canPickAssignee={canPickAssignee}
          self={self}
          onAssignee={setAssignee}
          onDueOn={setDueOn}
        />
      </div>
    </ReviewCard>
  )
}
