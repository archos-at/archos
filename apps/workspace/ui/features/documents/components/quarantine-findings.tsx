'use client'

import type { FC } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Chip, ChipLabel } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import {
  describeQuarantineReason,
  explainQuarantineReason,
  findingsOf,
  heldSentenceKey,
  MORE_PAGES_MARK,
  quarantineReasonHead,
  type QuarantineFinding,
  type QuarantineVerdict,
} from '@/lib/upload-screening/quarantine'

export interface QuarantineFindingsProps {
  verdict: QuarantineVerdict | null
  onShowFinding?: (finding: QuarantineFinding) => void
  shownFinding?: QuarantineFinding | null
  withoutSentence?: boolean
  className?: string
  testId?: string
}

const sameFinding = (a: QuarantineFinding | null | undefined, b: QuarantineFinding): boolean =>
  !!a && a.page === b.page && a.highlight === b.highlight

export const QuarantineFindings: FC<QuarantineFindingsProps> = ({
  verdict,
  onShowFinding,
  shownFinding,
  withoutSentence = false,
  className,
  testId = 'quarantine-findings',
}) => {
  const t = useTranslations(filesCopy)
  const reasons = verdict?.reasons ?? []
  const explainedAt = new Set(reasons.map((reason) => reasons.findLastIndex((other) => other.kind === reason.kind)))

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid={testId}>
      {reasons.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t('screening.findingsLabel')}>
          {reasons.map((reason, index) => {
            const findings = onShowFinding ? findingsOf(reason) : []
            return (
              <li key={`${index}-${reason.kind}-${reason.term ?? ''}`} className="flex flex-wrap items-center gap-1">
                <Chip variant="warning" size="sm">
                  <ShieldAlert aria-hidden />
                  <ChipLabel>{findings.length > 0 ? quarantineReasonHead(reason, t) : describeQuarantineReason(reason, t)}</ChipLabel>
                </Chip>
                {findings.map((finding) => {
                  const shown = sameFinding(shownFinding, finding)
                  return (
                    <Chip key={finding.page} asChild interactive variant={shown ? 'warning' : 'outline'} size="sm">
                      <button
                        type="button"
                        onClick={() => onShowFinding?.(finding)}
                        aria-pressed={shown}
                        aria-label={t('screening.showFinding', { page: finding.page })}
                        data-testid={`${testId}-page-${finding.page}`}
                      >
                        {t('screening.findingPage', { page: finding.page })}
                      </button>
                    </Chip>
                  )
                })}
                {/* The job listed only some of the pages (`pages_truncated`). As
                    text the phrase above ends in „…" already. */}
                {findings.length > 0 && reason.pages_truncated && (
                  <span
                    className="text-muted-foreground px-0.5 text-xs"
                    title={t('screening.morePages')}
                    data-testid={`${testId}-more-pages`}
                  >
                    <span aria-hidden>{MORE_PAGES_MARK}</span>
                    <span className="sr-only">{t('screening.morePages')}</span>
                  </span>
                )}
                {explainedAt.has(index) && (
                  <p className="text-muted-foreground w-full text-xs leading-snug" data-testid={`${testId}-basis`}>
                    {explainQuarantineReason(reason, t)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {verdict?.omitted ? (
        <p className="text-muted-foreground text-xs leading-snug" data-testid={`${testId}-omitted`}>
          {t('screening.omitted', { count: verdict.omitted })}
        </p>
      ) : null}
      {verdict?.checked === 'partial' && (
        <p className="text-muted-foreground text-xs leading-snug">{t('screening.partial')}</p>
      )}
      {!withoutSentence && (
        <p className="text-muted-foreground text-xs leading-snug" data-testid={`${testId}-sentence`}>
          {t(heldSentenceKey(verdict))}
        </p>
      )}
    </div>
  )
}
