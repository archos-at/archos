'use client'

import { type FC, useEffect, useState } from 'react'

import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { formatCredits } from '@/lib/format'

interface AnswerUsageDto {
  unit: 'credit' | 'token'
  credits: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  totalTokens: number
}

interface AnswerCostProps {
  conversationId: string
  messageId: string
}

export const AnswerCost: FC<AnswerCostProps> = ({ conversationId, messageId }) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const [usage, setUsage] = useState<AnswerUsageDto | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/usage`,
      { signal: controller.signal }
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { usage?: AnswerUsageDto | null } | null) => setUsage(body?.usage ?? null))
      .catch(() => undefined)
    return () => controller.abort()
  }, [conversationId, messageId])

  if (!usage) return null
  const tokens = new Intl.NumberFormat(locale)
  const label =
    usage.unit === 'credit'
      ? t('answerDetails.costCredits', { value: formatCredits(usage.credits, locale) })
      : t('answerDetails.costTokens', { value: tokens.format(usage.totalTokens) })
  const breakdown = t('answerDetails.costBreakdown', {
    prompt: tokens.format(usage.promptTokens),
    completion: tokens.format(usage.completionTokens),
    reasoning: tokens.format(usage.reasoningTokens),
  })

  return (
    <span className="text-subtle text-xs" data-testid="answer-cost" title={breakdown}>
      {label}
    </span>
  )
}
