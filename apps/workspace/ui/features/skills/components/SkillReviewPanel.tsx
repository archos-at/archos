'use client'

import type { FC } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { cn } from '@/lib/utils'
import type { SkillReviewFinding } from '@/adapters/api/skills-client'
import type { SkillReviewField, SkillReviewState } from '../hooks/use-skill-review'

export interface SkillReviewPanelProps {
  state: SkillReviewState
  stale: boolean
  findings: readonly SkillReviewFinding[]
  onRun: () => void
  onGoToField?: (field: SkillReviewField) => void
  className?: string
}

const FIELD_ORDER: readonly SkillReviewField[] = ['name', 'description', 'body']

export const SkillReviewPanel: FC<SkillReviewPanelProps> = ({
  state,
  stale,
  findings,
  onRun,
  onGoToField,
  className,
}) => {
  const t = useTranslations(skillsCopy)
  const running = state.kind === 'running'
  const ranBefore = state.kind === 'done' || state.kind === 'unavailable'
  const actionLabel = ranBefore ? t('editor.review.again') : t('editor.review.action')

  const open = FIELD_ORDER.map((field) => ({
    field,
    count: findings.filter((finding) => finding.field === field).length,
  })).filter((row) => row.count > 0)

  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      aria-labelledby="skill-review-heading"
      data-testid="skill-review-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="skill-review-heading" className="text-sm font-medium">
          {t('editor.review.heading')}
        </h3>
        <Button
          type="button"
          variant={stale && ranBefore ? 'default' : 'secondary'}
          size="sm"
          onClick={onRun}
          disabled={running}
          aria-busy={running}
          className="h-8 px-3.5 text-xs"
          data-testid="skill-review-run"
        >
          {/* Both labels stay mounted so the button does not change width when
              it starts working. */}
          <span className="inline-grid justify-items-start">
            <span
              className={cn(
                'col-start-1 row-start-1 inline-flex items-center gap-1.5',
                running && 'invisible',
              )}
              aria-hidden={running}
            >
              {actionLabel}
            </span>
            <span
              className={cn(
                'col-start-1 row-start-1 inline-flex items-center gap-1.5',
                !running && 'invisible',
              )}
              aria-hidden={!running}
            >
              <Spinner size="sm" aria-hidden />
              {t('editor.review.running')}
            </span>
          </span>
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">{t('editor.review.subtitle')}</p>

      {/* The verdict is stale and the author has not re-run yet: the one thing
          this panel must not do is let that pass quietly, because everything
          on screen is then about a draft that no longer exists. */}
      {stale && ranBefore && (
        <p
          className="text-foreground animate-in fade-in-0 rounded-lg border border-dashed px-3 py-2 text-xs duration-base ease-out motion-reduce:animate-none"
          role="status"
          data-testid="skill-review-stale"
        >
          {t('editor.review.staleAction')}
        </p>
      )}

      {state.kind === 'unavailable' && !stale && (
        <p
          className="text-muted-foreground animate-in fade-in-0 rounded-lg border border-dashed px-3 py-2 text-xs duration-base ease-out motion-reduce:animate-none"
          role="status"
          data-testid="skill-review-unavailable"
        >
          {/* Explicitly NOT "looks good": the reviewer never ran. */}
          {t('editor.review.unavailable')}
        </p>
      )}

      {state.kind === 'done' && findings.length === 0 && !stale && (
        <p
          className="text-foreground animate-in fade-in-0 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs duration-base ease-out motion-reduce:animate-none"
          role="status"
          data-testid="skill-review-clean"
        >
          <Check className="text-success mt-px size-3.5 shrink-0" aria-hidden />
          {t('editor.review.clean')}
        </p>
      )}

      {/* WHERE the open findings are, not what they say — they say it beside
          the field they are about, which is where they can be acted on. Each
          row is the way there. */}
      {state.kind === 'done' && open.length > 0 && !stale && (
        <ul className="flex flex-col gap-1.5" data-testid="skill-review-summary">
          {open.map(({ field, count }) => (
            <li key={field}>
              <button
                type="button"
                onClick={() => onGoToField?.(field)}
                disabled={!onGoToField}
                className={cn(
                  'focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2',
                  onGoToField && 'hover:bg-hover transition-colors duration-quick ease-out',
                )}
                data-testid={`skill-review-open-${field}`}
              >
                <span className="text-foreground font-medium">
                  {t(`editor.review.fields.${field}`)}
                </span>
                <span className="text-muted-foreground">
                  {t('editor.review.openCount', { count })}
                </span>
                {onGoToField && (
                  <ArrowRight className="text-muted-foreground ml-auto size-3.5" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
