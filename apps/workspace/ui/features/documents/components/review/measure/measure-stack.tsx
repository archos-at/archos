'use client'

import { useEffect, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { FloatingNote } from '@/components/ui/floating-toolbar'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentReview } from '../../../hooks/use-document-review'
import { MeasureModeStrip } from './measure-mode-strip'

const step = (tape: DocumentReview['tape']): 'start' | 'next' | 'close' => {
  const placed = tape.phase === 'placing' ? tape.points.length : 0
  if (placed === 0) return 'start'
  return tape.mode === 'area' && placed >= 3 ? 'close' : 'next'
}

export function MeasureStack({
  review,
  page,
  touch,
  scale,
  onSetScale,
  settingScale = false,
}: {
  review: Pick<DocumentReview, 'tool' | 'setTool' | 'tape'>
  page: number
  touch: boolean
  scale: JSX.Element
  onSetScale?: (page: number) => void
  settingScale?: boolean
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { tape } = review
  const shownPage = tape.page ?? page
  const { load } = tape
  const on = review.tool === 'measure' && tape.available
  useEffect(() => {
    if (on) load(shownPage)
  }, [on, load, shownPage])
  if (!on) return null
  const where = tape.phase === 'placing' ? step(tape) : 'start'
  const guide = touch
    ? [
        t(`review.measure.hintTouch.${tape.mode}.${where}`),
        where === 'start' ? t('review.measure.hintTouch.zoom') : null,
      ]
    : [t(`review.measure.hint.${tape.mode}.${where}`), t('review.measure.hint.escape')]
  const note = tape.unscaled(shownPage)
    ? t('review.measure.noScale')
    : tape.phase === 'measuring'
      ? t('review.measure.measuring')
      : tape.phase === 'failed'
        ? t('review.measure.failed')
        : tape.phase === 'refused'
          ? t(`review.measure.refused.${tape.refusal?.code ?? 'other'}`)
          : tape.phase === 'measured'
            ? null
            : guide.filter(Boolean).join(' · ')
  return (
    <>
      <MeasureModeStrip
        unscaled={tape.unscaled(shownPage)}
        tape={tape}
        onExit={() => review.setTool('select')}
        scale={scale}
      />
      {note && !settingScale && (
        <FloatingNote
          role={
            tape.phase === 'failed' || tape.phase === 'refused' || tape.unscaled(shownPage)
              ? 'alert'
              : 'status'
          }
          data-testid="review-tool-hint"
          data-phase={tape.phase}
          data-code={tape.refusal?.code}
          title={
            tape.refusal
              ? [tape.refusal.reason, tape.refusal.remedy].filter(Boolean).join(' ')
              : undefined
          }
        >
          {note}
          {tape.unscaled(shownPage) && onSetScale && (
            <Button
              size="sm"
              variant="secondary"
              className="pointer-events-auto ml-2 h-7 pointer-coarse:h-11"
              data-testid="measure-set-scale"
              onClick={() => onSetScale(shownPage)}
            >
              {t('review.measure.scale.set')}
            </Button>
          )}
        </FloatingNote>
      )}
    </>
  )
}
