import { useCallback } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { SheetTape } from '../../../hooks/use-sheet-tape'
import { formatScaleRatio } from '../../../lib/tape-format'

export function useScaleLabel(tape: Pick<SheetTape, 'scaleOf'>): (page: number) => string {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  return useCallback(
    (page: number) => {
      const scales = tape.scaleOf(page)
      if (!scales) return ''
      const ratio = scales.find((scale) => scale.ratio)?.ratio
      return ratio ? t('review.measure.scaleRatio', { ratio: formatScaleRatio(ratio, locale) }) : t('review.measure.scaleNone')
    },
    [tape, t, locale]
  )
}
