'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'

import { Chip } from '@/components/ui/chip'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Advanced, StepHeading } from '@/components/ui/step-form'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { cn } from '@/lib/utils'

import {
  CADENCES,
  type Cadence,
  type CronParts,
  partsToTimeValue,
  SCHEDULE_FREQUENCIES,
  supportedTimezones,
  timeValueToParts,
  toggleDay,
  weekdayName,
} from '../../lib/schedule'
import { UpcomingRuns } from './upcoming-runs'

export function ScheduleStep({
  cadence,
  onCadenceChange,
  dueAtLocal,
  onDueAtLocalChange,
  minDueAtLocal,
  dueAt,
  customCron,
  onCustomCronChange,
  parts,
  onPartsChange,
  cron,
  onCronChange,
  timezone,
  onTimezoneChange,
  effectiveCron,
  error,
  locale,
}: {
  cadence: Cadence
  onCadenceChange: (next: Cadence) => void
  dueAtLocal: string
  onDueAtLocalChange: (next: string) => void
  minDueAtLocal: string
  dueAt: Date | null
  customCron: boolean
  onCustomCronChange: (next: boolean) => void
  parts: CronParts
  onPartsChange: (next: CronParts) => void
  cron: string
  onCronChange: (next: string) => void
  timezone: string
  onTimezoneChange: (next: string) => void
  effectiveCron: string | null
  error: string | null
  locale: string
}): JSX.Element {
  const t = useTranslations(jobsCopy)
  const timezones = useMemo(() => supportedTimezones(), [])

  return (
    <section data-testid="wizard-step-schedule">
      <StepHeading title={t('builder.steps.scheduleTitle')} hint={t('builder.steps.scheduleHint')} />

      {/* Cards, not chips, because each answer needs a sentence: "once" and
          "recurring" are indistinguishable from their one-word labels alone,
          and a reader choosing between them is choosing between behaviours. */}
      <div
        role="radiogroup"
        aria-labelledby="cadence-label"
        className="grid gap-2 sm:grid-cols-3"
        data-testid="cadence-choice"
      >
        <span id="cadence-label" className="sr-only">
          {t('builder.cadence.label')}
        </span>
        {CADENCES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={cadence === option}
            onClick={() => onCadenceChange(option)}
            data-testid={`cadence-${option}`}
            className={cn(
              'border-border rounded-lg border px-3 py-2.5 text-left transition-colors duration-quick ease-out',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              cadence === option
                ? 'border-primary bg-primary-subtle'
                : 'hover:border-muted-foreground/40',
            )}
          >
            <span className="text-foreground block text-sm font-medium">
              {t(`builder.cadence.${option}`)}
            </span>
            <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
              {t(`builder.cadence.${option}Hint`)}
            </span>
          </button>
        ))}
      </div>

      {cadence === 'once' && (
        <div className="animate-in fade-in-0 mt-5 space-y-5 duration-base ease-out motion-reduce:animate-none">
          <Field>
            <FieldLabel htmlFor="due-at">{t('builder.dueAtLabel')}</FieldLabel>
            <FieldDescription>{t('builder.dueAtHint')}</FieldDescription>
            {/* `min` is advisory — the browser will not stop a typed past date
                and the server is the real check — but it makes the calendar
                open on the right side of today. */}
            <Input
              id="due-at"
              type="datetime-local"
              value={dueAtLocal}
              min={minDueAtLocal}
              onChange={(event) => onDueAtLocalChange(event.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </Field>

          <UpcomingRuns cron={null} dueAt={dueAt} timezone={timezone} locale={locale} />

          {error && <FieldError>{error}</FieldError>}
        </div>
      )}

      {cadence === 'recurring' && (
        <div className="animate-in fade-in-0 mt-5 space-y-5 duration-base ease-out motion-reduce:animate-none">
          {!customCron && (
            <>
              <Field>
                <FieldLabel id="schedule-frequency-label">{t('builder.presetLabel')}</FieldLabel>
                {/* Chips, not a dropdown: four options that fit on one line are
                    faster to compare side by side than behind a click, and the
                    chosen one stays visible while the time below it is set. */}
                <div
                  role="radiogroup"
                  aria-labelledby="schedule-frequency-label"
                  className="flex flex-wrap gap-2"
                >
                  {SCHEDULE_FREQUENCIES.map((frequency) => (
                    <Chip
                      key={frequency}
                      size="md"
                      interactive
                      asChild
                      variant={parts.frequency === frequency ? 'default' : 'outline'}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={parts.frequency === frequency}
                        onClick={() => onPartsChange({ ...parts, frequency })}
                        data-testid={`wizard-frequency-${frequency}`}
                      >
                        {t(`schedule.frequency.${frequency}`)}
                      </button>
                    </Chip>
                  ))}
                </div>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Hourly reads only the minute, so asking for a full time
                    would be asking for an answer that is then half-ignored. */}
                {parts.frequency !== 'hourly' && (
                  <Field>
                    <FieldLabel htmlFor="schedule-time">{t('builder.timeLabel')}</FieldLabel>
                    <Input
                      id="schedule-time"
                      type="time"
                      value={partsToTimeValue(parts)}
                      onChange={(event) => {
                        const next = timeValueToParts(event.target.value)
                        if (next) onPartsChange({ ...parts, ...next })
                      }}
                      className="tabular-nums"
                    />
                  </Field>
                )}
                {parts.frequency === 'hourly' && (
                  <Field>
                    <FieldLabel htmlFor="schedule-minute">{t('builder.minuteLabel')}</FieldLabel>
                    <Select
                      value={String(parts.minute)}
                      onValueChange={(value) => onPartsChange({ ...parts, minute: Number(value) })}
                    >
                      <SelectTrigger id="schedule-minute">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 15, 30, 45].map((minute) => (
                          <SelectItem key={minute} value={String(minute)}>
                            {t('builder.minutePast', { minute: String(minute).padStart(2, '0') })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                {parts.frequency === 'monthly' && (
                  <Field>
                    <FieldLabel htmlFor="schedule-monthday">{t('builder.monthDayLabel')}</FieldLabel>
                    <Select
                      value={String(parts.monthDay)}
                      onValueChange={(value) => onPartsChange({ ...parts, monthDay: Number(value) })}
                    >
                      <SelectTrigger id="schedule-monthday">
                        <SelectValue />
                      </SelectTrigger>
                      {/* Capped at 28 so a monthly schedule never skips
                          February — a "31st" schedule fires seven times a year
                          and nobody means that. */}
                      <SelectContent className="max-h-72">
                        {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                          <SelectItem key={day} value={String(day)}>
                            {t('builder.monthDayValue', { day })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>

              {/* Seven toggles, not a dropdown. "Montag, Mittwoch und Freitag"
                  and "werktags" are ordinary asks, and a single-day picker sent
                  both of them to the raw cron field — where nobody could check
                  what they had written. Monday first: this product's week
                  starts there. */}
              {parts.frequency === 'weekly' && (
                <Field>
                  <FieldLabel id="schedule-weekdays-label">{t('builder.weekdayLabel')}</FieldLabel>
                  <div
                    role="group"
                    aria-labelledby="schedule-weekdays-label"
                    className="flex flex-wrap gap-1.5"
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
                      const on = parts.weekdays.includes(weekday)
                      return (
                        <Chip
                          key={weekday}
                          size="md"
                          interactive
                          asChild
                          variant={on ? 'default' : 'outline'}
                        >
                          <button
                            type="button"
                            aria-pressed={on}
                            aria-label={weekdayName(weekday, locale)}
                            data-testid={`wizard-weekday-${weekday}`}
                            onClick={() => onPartsChange({ ...parts, weekdays: toggleDay(parts.weekdays, weekday) })}
                          >
                            {weekdayName(weekday, locale, 'short')}
                          </button>
                        </Chip>
                      )
                    })}
                  </div>
                  <FieldDescription>{t('builder.weekdayHint')}</FieldDescription>
                </Field>
              )}
            </>
          )}

          {customCron && (
            <Field>
              <FieldLabel htmlFor="schedule-cron">{t('builder.cronLabel')}</FieldLabel>
              <Input
                id="schedule-cron"
                value={cron}
                placeholder={t('builder.cronPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                onChange={(event) => onCronChange(event.target.value)}
                aria-invalid={error ? true : undefined}
              />
              <FieldDescription>{t('builder.cronHint')}</FieldDescription>
            </Field>
          )}

          <UpcomingRuns cron={effectiveCron} timezone={timezone} locale={locale} />

          {error && <FieldError>{error}</FieldError>}

          <Advanced
            label={t('builder.advancedSchedule')}
            summary={customCron ? t('builder.cronLabel') : null}
          >
            <Field>
              <FieldLabel htmlFor="schedule-timezone">{t('builder.timezoneLabel')}</FieldLabel>
              <Select value={timezone} onValueChange={onTimezoneChange}>
                <SelectTrigger id="schedule-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t('builder.timezoneHint')}</FieldDescription>
            </Field>

            <Field orientation="horizontal">
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor="schedule-custom-cron">{t('builder.customCronLabel')}</FieldLabel>
                <FieldDescription>{t('builder.customCronHint')}</FieldDescription>
              </div>
              <Switch
                id="schedule-custom-cron"
                checked={customCron}
                onCheckedChange={onCustomCronChange}
              />
            </Field>
          </Advanced>
        </div>
      )}
    </section>
  )
}
