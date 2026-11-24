'use client'

import { useEffect, type JSX } from 'react'
import { FloatingNote } from '@/components/ui/floating-toolbar'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentReview } from '../../../hooks/use-document-review'
import { MeasureModeStrip } from './measure-mode-strip'
import { ScaleControl } from './scale-control'
import { useScaleLabel } from './scale-label'

export function MeasureStack({ review, page, touch }: { review: Pick<DocumentReview, 'tool' | 'tape'>; page: number; touch: boolean }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const labelFor = useScaleLabel(review.tape)
  const { tape } = review
  const shownPage = tape.page ?? page
  const { load } = tape
  const on = review.tool === 'measure' && tape.available
  useEffect(() => {
    if (on) load(shownPage)
  }, [on, load, shownPage])
  if (!on) return null
  const note =
    tape.phase === 'measuring'
      ? t('review.measure.measuring')
      : tape.phase === 'failed'
        ? t('review.measure.failed')
        : tape.phase === 'refused'
          ? t(`review.measure.refused.${tape.refusal?.code ?? 'other'}`)
          : tape.phase === 'measured'
            ? null
            : t(`review.measure.${touch ? 'hintTouch' : 'hint'}.${tape.mode}`)
  return (
    <>
      <MeasureModeStrip tape={tape} scale={<ScaleControl calibration={{ labelFor }} page={shownPage} />} />
      {note && (
        <FloatingNote
          role={tape.phase === 'failed' || tape.phase === 'refused' ? 'alert' : 'status'}
          data-testid="review-tool-hint"
          data-phase={tape.phase}
          data-code={tape.refusal?.code}
          title={tape.refusal ? [tape.refusal.reason, tape.refusal.remedy].filter(Boolean).join(' ') : undefined}
        >
          {note}
        </FloatingNote>
      )}
    </>
  )
}
