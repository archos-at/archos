'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { StepHeading } from '@/components/ui/step-form'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { formatAbsoluteTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { scheduleSummary, type Cadence } from '../../lib/schedule'
import type { WizardValues } from '../../lib/wizard-state'

export function ReviewStep({
  values,
  sourceCount,
  cadence,
  effectiveCron,
  effectiveDueAt,
  timezone,
  enabled,
  onEnabledChange,
  locale,
}: {
  values: WizardValues
  sourceCount: number
  cadence: Cadence
  effectiveCron: string | null
  effectiveDueAt: Date | null
  timezone: string
  enabled: boolean
  onEnabledChange: (next: boolean) => void
  locale: string
}): JSX.Element {
  const t = useTranslations(jobsCopy)
  const [promptOpen, setPromptOpen] = useState(false)
  const compiled = values.prompt.trim()

  const rhythm = scheduleSummary(t, effectiveCron, timezone, locale, { withTimezone: false })
  const dueAtText = effectiveDueAt ? formatAbsoluteTime(effectiveDueAt.toISOString(), locale) : ''

  const summary =
    cadence === 'recurring'
      ? t('builder.reviewSentence', { cadence: rhythm.toLocaleLowerCase(locale) })
      : cadence === 'once'
        ? t('builder.reviewSentenceOnce', { dueAt: dueAtText })
        : t('builder.reviewSentenceManual')

  const whenValue =
    cadence === 'recurring'
      ? `${rhythm} · ${timezone}`
      : cadence === 'once'
        ? `${dueAtText} · ${timezone}`
        : t('list.manualOnly')

  return (
    <section data-testid="wizard-step-review">
      <StepHeading title={t('builder.steps.reviewTitle')} hint={t('builder.steps.reviewHint')} />

      <p className="text-foreground text-base leading-relaxed" data-testid="wizard-review-sentence">
        {summary}
      </p>

      <dl className="border-border mt-4 divide-y rounded-lg border">
        <ReviewRow label={t('builder.nameLabel')} value={values.name.trim()} />
        <ReviewRow label={t('builder.scheduleSection')} value={whenValue} />
        <ReviewRow
          label={t('builder.sourcesSection')}
          value={
            sourceCount > 0
              ? t('builder.sourcesSummary', { count: sourceCount })
              : t('builder.sourcesAll')
          }
        />
      </dl>

      <Collapsible open={promptOpen} onOpenChange={setPromptOpen} className="mt-4">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2"
          >
            <ChevronDown
              className={cn(
                'size-4 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none',
                promptOpen && 'rotate-180',
              )}
              aria-hidden
            />
            <FileText className="size-4 shrink-0" aria-hidden />
            {t('builder.preview.title')}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="duration-base ease-out motion-reduce:animate-none">
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            {t('builder.preview.subtitle')}
          </p>
          <pre
            data-testid="job-prompt-preview"
            className="bg-muted text-foreground mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg p-4 font-mono text-xs leading-relaxed"
          >
            {compiled}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      {/* The only switch left in the wizard, and only where "paused" says
          something: a task that fires on its own can be saved switched OFF,
          which is how somebody sets one up before the site work starts.
          A manual task has nothing to pause — it runs when a person presses
          the button — so offering it there produced a task that could not run
          at all and did not say why. It still appears on a manual task that is
          ALREADY paused, or there would be no way back. */}
      {(cadence !== 'manual' || !enabled) && (
        <Field
          orientation="horizontal"
          className="border-border mt-5 rounded-lg border px-3 py-2.5"
        >
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="schedule-enabled">{t('builder.enabledLabel')}</FieldLabel>
            <FieldDescription>{t('builder.enabledHint')}</FieldDescription>
          </div>
          <Switch id="schedule-enabled" checked={enabled} onCheckedChange={onEnabledChange} />
        </Field>
      )}
    </section>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="text-foreground min-w-0 truncate text-sm font-medium">{value}</dd>
    </div>
  )
}
