'use client'

import { type FC } from 'react'
import { Gauge } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import type { AnswerConfidenceCappedReason } from '@/lib/conversations/message-provenance'

export type AnswerConfidence = 'low' | 'medium' | 'high'

const CAPPED_REASON_KEYS: Record<AnswerConfidenceCappedReason, string> = {
  ungrounded: 'ungrounded',
  quote_unverified: 'quoteUnverified',
  law_unsettled: 'lawUnsettled',
  open_point: 'openPoint',
  normative_claim_uncited: 'normativeClaimUncited',
  measurement_only: 'measurementOnly',
  citation_fallback: 'citationFallback',
}

interface ConfidenceChipProps {
  confidence: AnswerConfidence | null | undefined
  cappedReason?: AnswerConfidenceCappedReason
  reason?: string
  version?: 1 | 2
  check?: ConfidenceCheck
}

export const ConfidenceChip: FC<ConfidenceChipProps> = ({
  confidence,
  cappedReason,
  reason,
  version,
  check,
}) => {
  const t = useTranslations(chatCopy)

  if (check?.status === 'unavailable') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Chip asChild variant="muted" size="sm" interactive>
            <button data-attr="confidence-check-unavailable" type="button" data-testid="confidence-check-unavailable">
              <Gauge aria-hidden="true" />
              {t('confidence.checked.unavailable')}
            </button>
          </Chip>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{t('confidence.checked.unavailableTooltip')}</TooltipContent>
      </Tooltip>
    )
  }
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
    return null
  }
  if (check?.status === 'judged') {
    return <CheckedChip confidence={confidence} check={check} cappedReason={cappedReason} />
  }

  const byClaim = version === 2
  const levelLabel = t(`confidence.levels.${confidence}`)
  const label = t('confidence.label', { level: levelLabel })
  const variant = confidence === 'low' ? 'warning' : 'muted'
  const cappedReasonText = cappedReason
    ? t(
        `${byClaim ? 'confidence.byClaim.cappedReasons' : 'confidence.cappedReasons'}.${CAPPED_REASON_KEYS[cappedReason]}`
      )
    : undefined
  const displayReason = reason?.trim() ? reason : undefined

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Chip
          asChild
          variant={variant}
          size="sm"
          interactive
          aria-label={t('confidence.ariaLabel', { level: levelLabel })}
        >
          <button type="button">
            <Gauge aria-hidden="true" />
            {label}
          </button>
        </Chip>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <span className="block">
          {t(
            `${byClaim ? 'confidence.byClaim.levelMeanings' : 'confidence.levelMeanings'}.${confidence}`
          )}
        </span>
        {displayReason ? (
          <span className="mt-1 block">
            <span className="font-medium">
              {t(cappedReason ? 'confidence.reasonLabelBeforeCap' : 'confidence.reasonLabel')}:
            </span>{' '}
            {displayReason}
          </span>
        ) : null}
        <span className="mt-1 block">
          {t(byClaim ? 'confidence.byClaim.tooltip' : 'confidence.tooltip')}
        </span>
        {cappedReasonText ? <span className="mt-1 block">{cappedReasonText}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

const CheckedChip: FC<{
  confidence: AnswerConfidence
  check: ConfidenceCheck
  cappedReason: AnswerConfidenceCappedReason | null | undefined
}> = ({ confidence, check, cappedReason }) => {
  const t = useTranslations(chatCopy)
  const levelLabel = t(`confidence.levels.${confidence}`)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Chip
          asChild
          variant={confidence === 'low' ? 'warning' : 'muted'}
          size="sm"
          interactive
          aria-label={t('confidence.checked.ariaLabel', { level: levelLabel })}
        >
          <button type="button">
            <Gauge aria-hidden="true" />
            {t('confidence.label', { level: levelLabel })}
          </button>
        </Chip>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <span className="block">{t(`confidence.checked.levelMeanings.${confidence}`)}</span>
        {check.findings.length > 0 ? (
          <span className="mt-1 block" data-testid="confidence-check-findings">
            <span className="font-medium">{t('confidence.checked.findingsLabel')}:</span>
            {check.findings.map((finding) => (
              <span key={`${finding.problem}-${finding.statement}`} className="mt-0.5 block">
                „{finding.statement}“ – {t(`confidence.checked.problems.${finding.problem}`)}
                {finding.reason ? `: ${finding.reason}` : ''} (
                {t('confidence.checked.checkedAgainst', {
                  source: finding.source === 'none' ? t('confidence.checked.noSource') : finding.source,
                })}
                )
              </span>
            ))}
          </span>
        ) : null}
        <span className="mt-1 block">{t('confidence.checked.tooltip')}</span>
        {cappedReason === 'quote_unverified' || cappedReason === 'law_unsettled' || cappedReason === 'open_point' ? (
          <span className="mt-1 block">{t(`confidence.checked.${CAPPED_REASON_KEYS[cappedReason]}`)}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
