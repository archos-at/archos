'use client'

import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { RatingsFilters } from '@/lib/feedback/filters'

export function useRatingsFilterLabels(filters: RatingsFilters): string[] {
  const t = useTranslations(platformCopy)
  const or = (values: string[]): string => values.join(t('answerFeedback.filters.or'))
  const labels: string[] = []
  if (filters.verdict) {
    const value = t(filters.verdict === 'up' ? 'answerFeedback.filters.verdictUp' : 'answerFeedback.filters.verdictDown')
    labels.push(t('answerFeedback.chip.verdict', { value }))
  }
  if (filters.reasons.length) {
    labels.push(t('answerFeedback.chip.reason', { value: or(filters.reasons.map((key) => t(`answerFeedback.reasons.${key}`))) }))
  }
  if (filters.topics.length) {
    labels.push(t('answerFeedback.chip.topic', { value: or(filters.topics.map((key) => t(`answerFeedback.topics.${key}`))) }))
  }
  if (filters.modes.length) {
    labels.push(t('answerFeedback.chip.mode', { value: or(filters.modes.map((key) => t(`answerFeedback.modes.${key}`))) }))
  }
  if (filters.confidences.length) {
    labels.push(
      t('answerFeedback.chip.confidence', {
        value: or(filters.confidences.map((key) => t(`answerFeedback.confidences.${key}`))),
      })
    )
  }
  if (filters.hasComment) labels.push(t('answerFeedback.filters.hasComment'))
  if (filters.hasExpectedAnswer) labels.push(t('answerFeedback.filters.hasExpected'))
  if (filters.query) labels.push(t('answerFeedback.chip.query', { value: filters.query }))
  return labels
}
