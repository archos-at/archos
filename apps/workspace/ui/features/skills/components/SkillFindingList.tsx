'use client'

import type { FC } from 'react'
import { AlertTriangle, Lightbulb, XCircle } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { cn } from '@/lib/utils'
import type { SkillReviewFinding } from '@/adapters/api/skills-client'

const SEVERITY_ICON = {
  error: XCircle,
  warning: AlertTriangle,
  suggestion: Lightbulb,
} as const

const SEVERITY_TONE = {
  error: 'text-destructive',
  warning: 'text-warning-foreground',
  suggestion: 'text-muted-foreground',
} as const

export interface SkillFindingListProps {
  findings: readonly SkillReviewFinding[]
  variant?: 'inline' | 'full'
  stale?: boolean
  className?: string
  'data-testid'?: string
}

export const SkillFindingList: FC<SkillFindingListProps> = ({
  findings,
  variant = 'full',
  stale = false,
  className,
  'data-testid': testId,
}) => {
  const t = useTranslations(skillsCopy)
  if (findings.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid={testId}>
      {stale && (
        <p className="text-muted-foreground text-xs" data-testid="skill-findings-stale">
          {t('editor.review.stale')}
        </p>
      )}
      <ul
        className={cn(
          'animate-in fade-in-0 flex flex-col gap-1.5 duration-base ease-out motion-reduce:animate-none',
          stale && 'opacity-60',
        )}
      >
        {findings.map((finding, index) => {
          const Icon = SEVERITY_ICON[finding.severity]
          return (
            <li
              key={`${finding.field}-${index}`}
              className="flex items-start gap-2.5 rounded-lg border px-3 py-2"
              data-severity={finding.severity}
              data-field={finding.field}
            >
              <Icon
                className={cn('mt-px size-3.5 shrink-0', SEVERITY_TONE[finding.severity])}
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-foreground text-xs font-medium">
                  {variant === 'full' && (
                    <>
                      <span className="text-muted-foreground font-mono text-[10.5px]">
                        {t(`editor.review.fields.${finding.field}`)}
                      </span>{' '}
                    </>
                  )}
                  {finding.message}
                </p>
                {/* The suggested revision, as ADVICE. Never written into the
                    field for the author: it is prose („Ergänzen Sie den
                    Anlass: …"), and pasting it would put words in their skill
                    that neither they nor the reviewer wrote. */}
                {finding.fix && (
                  <p className="text-muted-foreground text-xs leading-snug">{finding.fix}</p>
                )}
                {/* The rule that produced this, quietly. It is what turns a
                    complaint into a citation — an author who disagrees can go
                    read the rule instead of arguing with a verdict. Muted and
                    last, because it is provenance, not the point. */}
                {finding.check && (
                  <p className="text-muted-foreground font-mono text-xs leading-snug">
                    {finding.check}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
