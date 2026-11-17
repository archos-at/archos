'use client'

import { useCallback } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { AnnotationView } from '@/lib/annotations/types'
import { splitDocumentName } from '@/lib/documents/display-name'
import type { RevisionRef } from '@/lib/documents/revision-links'
import type { DocumentReview } from '../../hooks/use-document-review'
import type { CheckFixed } from './review-panel'

export function checkFixedQuestion(
  t: (key: string, values?: Record<string, string | number>) => string,
  locale: string,
  {
    marks,
    from,
    documentName,
    revisionLabel,
  }: {
    marks: readonly Pick<AnnotationView, 'number'>[]
    from: RevisionRef | null
    documentName: string
    revisionLabel: string | null
  }
): string {
  const numbers = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    [...marks].sort((a, b) => a.number - b.number).map((mark) => String(mark.number))
  )
  if (from) {
    return t('review.checkFixed.seedFrom', {
      count: marks.length,
      numbers,
      from: from.filename,
      current: splitDocumentName(documentName).stem,
    })
  }
  return t('review.checkFixed.seed', {
    count: marks.length,
    numbers,
    current: revisionLabel ?? t('review.checkFixed.currentRevision'),
  })
}

export function useCheckFixed(
  review: DocumentReview,
  { documentName, revisionLabel }: { documentName: string; revisionLabel: string | null }
): CheckFixed | undefined {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const { piloti, canAnnotate, documentId } = review
  const ask = piloti.ask
  const check = useCallback<CheckFixed>(
    (marks, from) =>
      void ask({
        text: checkFixedQuestion(t, locale, { marks, from, documentName, revisionLabel }),
        region: null,
        effort: 'medium',
        checkFixed: { documentId: from?.id ?? documentId, annotationIds: marks.map((mark) => mark.id) },
      }),
    [ask, t, locale, documentName, revisionLabel, documentId]
  )
  return piloti.available && canAnnotate ? check : undefined
}
