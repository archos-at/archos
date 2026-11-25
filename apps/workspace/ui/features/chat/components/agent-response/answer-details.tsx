import { memo, useState } from 'react'

import { cn } from '@/lib/utils'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useTranslations } from '@/i18n'
import { AnswerCost } from '../AnswerCost'
import { chatCopy } from '@/i18n/namespaces/chat'
import { formatTime } from '@/shared/utils/format-time'
import { formatDurationElapsed } from '@/lib/format'
import type { CitationSource } from '../../types'
import type { AnswerConfidenceCappedReason } from '@/lib/conversations/message-provenance'
import { SkillsUsedDisclosure } from '@/features/skills/components/SkillsUsedDisclosure'
import { ConfidenceChip, type AnswerConfidence } from '../ConfidenceChip'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import { CitationsRemovedNote, ResearchTruncatedNote, AnswerDegradedNote } from './answer-notes'
import { ReadSourcesSection } from './read-sources'
import { AnswerTrailSection } from './answer-trail'

export interface AnswerDetailsProps {
  hasConfidence: boolean
  answerConfidence?: AnswerConfidence
  answerConfidenceCappedReason?: AnswerConfidenceCappedReason
  answerConfidenceReason?: string
  confidenceCheck?: ConfidenceCheck
  answerConfidenceVersion?: 1 | 2
  skillsActivated?: string[]
  skillsHidden?: string[]
  showReasoning?: boolean
  researchTruncated?: true
  truncationReason?: string
  degradedReasons?: string[]
  citationsRemoved?: { count: number; reasons: string[] }
  readSources?: CitationSource[]
  hasAnswerSources: boolean
  timestamp?: Date | string
  answerDurationMs?: number
  conversationId?: string | null
  messageId?: string
}

/** A note the reader must not miss is in the details: it marks the trigger. */
export const detailsNeedAttention = ({
  researchTruncated,
  degradedReasons,
  citationsRemoved,
  answerConfidence,
}: Pick<
  AnswerDetailsProps,
  'researchTruncated' | 'degradedReasons' | 'citationsRemoved' | 'answerConfidence'
>): boolean =>
  Boolean(
    researchTruncated ||
    degradedReasons?.length ||
    citationsRemoved?.count ||
    answerConfidence === 'low'
  )

/** „Antwortdetails" as an icon on the footer's line; its content opens in the footer's drawer. */
export function AnswerDetailsTrigger({
  open,
  onToggle,
  needsAttention,
  controls,
}: {
  open: boolean
  onToggle: () => void
  needsAttention: boolean
  controls: string
}) {
  const t = useTranslations(chatCopy)
  const [attentionAtMount] = useState(needsAttention)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-attr="answer-details-trigger"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={open ? controls : undefined}
          className={cn(
            'text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring/60 duration-quick relative inline-flex size-6 items-center justify-center rounded-control transition-colors ease-out focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11',
            open && 'bg-hover text-foreground'
          )}
          aria-label={t(
            needsAttention ? 'answerDetails.triggerAriaAttention' : 'answerDetails.triggerAria'
          )}
          data-testid="answer-details-trigger"
        >
          <Info className="size-3.5 pointer-coarse:size-4" aria-hidden="true" />
          {needsAttention && (
            <span
              aria-hidden="true"
              data-testid="answer-details-attention"
              className={cn(
                'text-feedback-warning absolute top-1 right-1 size-1.5 rounded-full bg-current pointer-coarse:top-2.5 pointer-coarse:right-2.5',
                !attentionAtMount &&
                  'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none'
              )}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{t('answerDetails.trigger')}</TooltipContent>
    </Tooltip>
  )
}

export const AnswerDetailsBody = memo(function AnswerDetailsBody({
  hasConfidence,
  answerConfidence,
  answerConfidenceCappedReason,
  answerConfidenceReason,
  confidenceCheck,
  answerConfidenceVersion,
  skillsActivated,
  skillsHidden,
  showReasoning,
  researchTruncated,
  truncationReason,
  degradedReasons,
  citationsRemoved,
  readSources,
  hasAnswerSources,
  timestamp,
  answerDurationMs,
  conversationId,
  messageId,
}: AnswerDetailsProps) {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  return (
    <div className="flex flex-col gap-2">
      {hasConfidence && (
        <ConfidenceChip
          confidence={answerConfidence}
          cappedReason={answerConfidenceCappedReason}
          reason={answerConfidenceReason}
          check={confidenceCheck}
          version={answerConfidenceVersion}
        />
      )}
      <SkillsUsedDisclosure
        skillsActivated={skillsActivated}
        hiddenSkills={skillsHidden}
        showReasoning={showReasoning}
      />
      <ResearchTruncatedNote
        researchTruncated={researchTruncated}
        truncationReason={truncationReason}
        hasSources={hasAnswerSources}
      />
      <AnswerDegradedNote degradedReasons={degradedReasons} />
      <CitationsRemovedNote citationsRemoved={citationsRemoved} />
      <ReadSourcesSection readSources={readSources} />
      {conversationId && messageId ? (
        <AnswerTrailSection conversationId={conversationId} messageId={messageId} />
      ) : null}
      {(Boolean(timestamp) || Boolean(answerDurationMs)) && (
        <span className="text-subtle text-xs" data-testid="answer-time">
          {timestamp && formatTime(timestamp, locale)}
          {timestamp && answerDurationMs ? ' · ' : null}
          {answerDurationMs
            ? t('answerDetails.duration', {
                duration: formatDurationElapsed(answerDurationMs / 1000, locale),
              })
            : null}
        </span>
      )}
      {conversationId && messageId ? (
        <AnswerCost conversationId={conversationId} messageId={messageId} />
      ) : null}
    </div>
  )
})
