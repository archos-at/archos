import { type ReactNode, memo, useState } from 'react'

import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { AnswerCost } from '../AnswerCost'
import { chatCopy } from '@/i18n/namespaces/chat'
import { formatTime } from '@/shared/utils/format-time'
import { formatDurationElapsed } from '@/lib/format'
import type { CitationSource } from '../../types'
import type { AnswerConfidenceCappedReason } from '@/lib/conversations/message-provenance'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SkillsUsedDisclosure } from '@/features/skills/components/SkillsUsedDisclosure'
import { ConfidenceChip, type AnswerConfidence } from '../ConfidenceChip'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'
import { CitationsRemovedNote, ResearchTruncatedNote, AnswerDegradedNote } from './answer-notes'
import { ReadSourcesSection } from './read-sources'

export const AnswerDetails = memo(function AnswerDetails({
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
  before,
  beside,
  after,
}: {
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
  before?: ReactNode
  beside?: ReactNode
  after?: ReactNode
}) {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  const needsAttention = Boolean(
    researchTruncated ||
    degradedReasons?.length ||
    citationsRemoved?.count ||
    answerConfidence === 'low'
  )
  const [attentionAtMount] = useState(needsAttention)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex w-full flex-col">
      {/* One line: copy, the trigger, and feedback at the far end. The
          Collapsible is full-width so its content can open below; with the
          trigger alone inside it, it took a line of its own under the rest. */}
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        {before}
        <CollapsibleTrigger
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 touch-target duration-quick flex items-center gap-1.5 self-start rounded-control text-xs leading-relaxed transition-colors ease-out focus-visible:ring-2 focus-visible:outline-none pointer-coarse:self-center"
          aria-label={t(
            needsAttention ? 'answerDetails.triggerAriaAttention' : 'answerDetails.triggerAria'
          )}
          data-testid="answer-details-trigger"
        >
          <span>{t('answerDetails.trigger')}</span>
          <span className="relative inline-flex">
            <ChevronDown
              className={`duration-quick size-3 shrink-0 transition-transform ease-out motion-reduce:transition-none${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            {needsAttention && (
              <span
                aria-hidden="true"
                data-testid="answer-details-attention"
                className={cn(
                  'text-feedback-warning absolute top-0 -right-2 size-1.5 rounded-full bg-current',
                  !attentionAtMount &&
                    'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none'
                )}
              />
            )}
          </span>
        </CollapsibleTrigger>
        {beside}
        {after ? (
          <>
            <span className="flex-1" aria-hidden="true" />
            {after}
          </>
        ) : null}
      </div>
      <CollapsibleContent className="mt-1.5">
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
      </CollapsibleContent>
    </Collapsible>
  )
})
