import { type FC } from 'react'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { ANSWER_DEGRADED_REASONS, TRUNCATION_REASONS } from '@/lib/conversations/message-provenance'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const CITATION_REMOVAL_REASONS = [
  'url_not_in_registry',
  'citation_key_not_in_registry',
  'unverifiable',
  'duplicate',
  'ungrounded',
  'quote_unverified',
] as const

function localizeToken(
  t: Translator,
  group: string,
  token: string,
  known: readonly string[]
): string | null {
  return known.includes(token) ? t(`${group}.${token}`) : null
}

function localizeTokens(
  t: Translator,
  group: string,
  tokens: string[] | undefined,
  known: readonly string[]
): string[] {
  const lines: string[] = []
  for (const token of tokens ?? []) {
    const line = typeof token === 'string' ? localizeToken(t, group, token, known) : null
    if (line && !lines.includes(line)) lines.push(line)
  }
  return lines
}

export const CitationsRemovedNote: FC<{
  citationsRemoved?: { count: number; reasons: string[] }
}> = ({ citationsRemoved }) => {
  const t = useTranslations(chatCopy)
  if (!citationsRemoved || citationsRemoved.count <= 0) return null

  const label = t('answerSources.citationsRemoved', { count: citationsRemoved.count })
  const reasons = localizeTokens(
    t,
    'answerSources.citationsRemovedReason',
    citationsRemoved.reasons,
    CITATION_REMOVAL_REASONS
  )

  const text = (
    <span className="text-muted-foreground text-xs leading-relaxed" role="note">
      {label}
    </span>
  )

  if (reasons.length === 0) {
    return <div className="mt-1.5">{text}</div>
  }

  return (
    <div className="mt-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="focus-visible:ring-ring/60 cursor-help rounded-control text-left focus-visible:ring-2 focus-visible:outline-none"
            aria-label={label}
          >
            <span className="text-muted-foreground text-xs leading-relaxed underline decoration-dotted underline-offset-2">
              {label}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {/* `text-current`: the tooltip paints its own foreground, and the
              eyebrow's muted ink would drop below AA on it. */}
          <SectionLabel className="mb-1 block text-current">
            {t('answerSources.citationsRemovedReasonsLabel')}
          </SectionLabel>
          <ul className="list-disc space-y-0.5 pl-4">
            {reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export const LookupFoundNothingNote: FC<{ show: boolean }> = ({ show }) => {
  const t = useTranslations(chatCopy)
  if (!show) return null
  return (
    <div className="mt-1.5" data-testid="lookup-found-nothing">
      <span className="text-feedback-warning text-xs leading-relaxed" role="note">
        {t('answerSources.lookupFoundNothing')}
      </span>
    </div>
  )
}

export const ResearchTruncatedNote: FC<{
  researchTruncated?: true
  truncationReason?: string
  hasSources: boolean
}> = ({ researchTruncated, truncationReason, hasSources }) => {
  const t = useTranslations(chatCopy)
  if (!researchTruncated) return null
  const sentence = t(
    hasSources ? 'answerSources.researchTruncated' : 'answerSources.researchTruncatedWithoutSources'
  )
  const cause = truncationReason
    ? localizeToken(t, 'answerSources.truncationReason', truncationReason, TRUNCATION_REASONS)
    : null
  return (
    <div className="mt-1.5">
      <span className="text-muted-foreground text-xs leading-relaxed" role="note">
        {cause ? `${sentence} (${cause})` : sentence}
      </span>
    </div>
  )
}

export const AnswerDegradedNote: FC<{ degradedReasons?: string[] }> = ({ degradedReasons }) => {
  const t = useTranslations(chatCopy)
  const lines = localizeTokens(
    t,
    'answerSources.degradedReason',
    degradedReasons,
    ANSWER_DEGRADED_REASONS
  )
  if (lines.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {lines.map((line) => (
        <span key={line} className="text-muted-foreground text-xs leading-relaxed" role="note">
          {line}
        </span>
      ))}
    </div>
  )
}
