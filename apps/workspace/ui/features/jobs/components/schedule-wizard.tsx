'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { FieldShell, useAppForm } from '@/components/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Stepper } from '@/components/ui/stepper'
import { Advanced, StepHeading } from '@/components/ui/step-form'
import { useLocale, useTranslations } from '@/i18n'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { createDataSourcesClient, type DataSourceFromAPI } from '@/adapters/api/data-sources-client'
import {
  createJob,
  runJob,
  updateJob,
  JobApiError,
  type CreateJobInput,
  type Job,
} from '@/adapters/api/jobs-client'
import { SkillPromptField } from '@/features/skills/components/SkillPromptField'
import { capturePosthog } from '@/lib/analytics/posthog'
import {
  buildCron,
  browserTimezone,
  DEFAULT_CRON_PARTS,
  isPlausibleCron,
  parseCronParts,
  type CronParts,
  type Cadence,
  cadenceOf,
  toDateTimeLocal,
  defaultDueAt,
} from '../lib/schedule'
import type { ScheduleDraft } from '../lib/schedule-draft'
import { suggestName } from '../lib/suggest-job-name'
import { SCHEDULE_STEP, STEP_KEYS, type StepKey, type WizardValues } from '../lib/wizard-state'
import { ReviewStep } from './schedule-wizard/review-step'
import { ScheduleStep } from './schedule-wizard/schedule-step'
import { WizardNav } from './schedule-wizard/wizard-nav'

export { suggestName }

const ALWAYS_ON_IDS: readonly string[] = ['knowledge_layer', 'ris']

interface ScheduleWizardProps {
  projectId: string
  job: Job | null
  draft?: ScheduleDraft | null
  onSaved: () => void
  onCancel: () => void
}

export function ScheduleWizard({
  projectId,
  job,
  draft,
  onSaved,
  onCancel,
}: ScheduleWizardProps): JSX.Element {
  const t = useTranslations(jobsCopy)
  const { locale } = useLocale()

  const [stepIndex, setStepIndex] = useState(0)
  const [furthest, setFurthest] = useState(0)

  const [sources, setSources] = useState<DataSourceFromAPI[] | null>(null)
  const [sourcesError, setSourcesError] = useState(false)
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(job?.dataSources ?? []),
  )

  const [enabled, setEnabled] = useState<boolean>(job?.enabled ?? true)
  const [cadence, setCadence] = useState<Cadence>(() =>
    job ? cadenceOf(job) : 'recurring',
  )
  const [dueAtLocal, setDueAtLocal] = useState<string>(() =>
    toDateTimeLocal(job?.dueAt ? new Date(job.dueAt) : defaultDueAt()),
  )
  const [customCron, setCustomCron] = useState<boolean>(
    Boolean(job?.scheduleCron) && parseCronParts(job?.scheduleCron) === null,
  )
  const [parts, setParts] = useState<CronParts>(
    () => parseCronParts(job?.scheduleCron) ?? DEFAULT_CRON_PARTS,
  )
  const [cron, setCron] = useState<string>(job?.scheduleCron ?? buildCron(DEFAULT_CRON_PARTS))
  const [timezone, setTimezone] = useState<string>(job?.scheduleTimezone ?? browserTimezone())
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const effectiveCron =
    cadence === 'recurring' ? (customCron ? cron.trim() : buildCron(parts)) : null
  const minDueAtLocal = useMemo(() => toDateTimeLocal(new Date()), [])

  const runAfterSaveRef = useRef(false)

  const runOnce = useCallback(
    async (jobId: string): Promise<void> => {
      try {
        await runJob(projectId, jobId)
      } catch {
        toast.warning(t('builder.runNowFailed'))
      }
    },
    [projectId, t],
  )

  const effectiveDueAt = useMemo(() => {
    if (cadence !== 'once' || !dueAtLocal) return null
    const parsed = new Date(dueAtLocal)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }, [cadence, dueAtLocal])

  useEffect(() => {
    const controller = new AbortController()
    createDataSourcesClient()
      .getDataSources(controller.signal)
      .then((response) => setSources(response.data_sources))
      .catch(() => {
        if (!controller.signal.aborted) setSourcesError(true)
      })
    return () => controller.abort()
  }, [])

  const additionalSources = useMemo(
    () => sources?.filter((source) => !ALWAYS_ON_IDS.includes(source.id)) ?? null,
    [sources],
  )

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('builder.nameRequired')).max(200, t('builder.nameTooLong')),
        prompt: z
          .string()
          .trim()
          .min(1, t('builder.promptRequired'))
          .max(8000, t('builder.promptTooLong')),
      }),
    [t],
  )

  const form = useAppForm({
    defaultValues: {
      name: job?.name ?? draft?.name ?? '',
      prompt: job?.prompt ?? draft?.prompt ?? '',
    } satisfies WizardValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setScheduleError(null)

      if (effectiveCron && !isPlausibleCron(effectiveCron)) {
        setScheduleError(t('builder.cronInvalid'))
        setStepIndex(SCHEDULE_STEP)
        return
      }

      const payload: CreateJobInput = {
        name: value.name.trim(),
        prompt: value.prompt.trim(),
        skillName: null,
        dataSources: selectedSources.size > 0 ? Array.from(selectedSources) : null,
        enabled,
        scheduleCron: effectiveCron,
        scheduleTimezone: timezone,
        dueAt: effectiveDueAt ? effectiveDueAt.toISOString() : null,
      }

      try {
        const analytics = {
          additional_source_count: selectedSources.size,
          schedule_enabled: cadence !== 'manual',
          cadence,
          enabled,
        }
        const runNow = runAfterSaveRef.current
        if (job) {
          await updateJob(projectId, job.id, payload)
          capturePosthog('job_updated', analytics)
          if (runNow) await runOnce(job.id)
          toast.success(t('builder.updateSuccess'))
        } else {
          const created = await createJob(projectId, payload)
          if (runNow) await runOnce(created.id)
          capturePosthog('job_created', analytics)
          toast.success(t('builder.createSuccess'))
        }
        onSaved()
      } catch (err) {
        if (err instanceof JobApiError && (err.status === 400 || err.status === 422)) {
          const message = err.serverMessage ?? t('builder.saveError')
          if (cadence !== 'manual') {
            setScheduleError(message)
            setStepIndex(SCHEDULE_STEP)
          } else {
            setFormError(message)
          }
        } else {
          setFormError(t('builder.saveError'))
        }
        toast.error(t('builder.saveError'))
      } finally {
        runAfterSaveRef.current = false
      }
    },
  })

  const steps = STEP_KEYS.map((key) => ({ key, label: t(`builder.steps.${key}`) }))
  const step: StepKey = STEP_KEYS[stepIndex]

  const goTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(STEP_KEYS.length - 1, index))
      const values = form.state.values as WizardValues
      if (values.name.trim().length === 0) {
        const suggested = suggestName(values.prompt)
        if (suggested) form.setFieldValue('name', suggested)
      }
      setStepIndex(next)
      setFurthest((reached) => Math.max(reached, next))
    },
    [form],
  )

  const toggleSource = (id: string, checked: boolean): void => {
    setSelectedSources((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
      data-testid="schedule-wizard"
    >
      <Stepper
        steps={steps}
        current={stepIndex}
        furthest={furthest}
        onSelect={goTo}
        label={t('builder.stepsLabel')}
        progressLabel={t('builder.stepProgress', {
          current: stepIndex + 1,
          total: STEP_KEYS.length,
        })}
      />

      <div className="min-h-[22rem]">
        {/* Step 1 is rendered here rather than extracted, because it is the
            only step that binds form FIELDS and `form.AppField` has to be
            reached from the form it belongs to. */}
        {step === 'task' && (
          <section data-testid="wizard-step-task">
            <StepHeading title={t('builder.steps.taskTitle')} hint={t('builder.steps.taskHint')} />
            {/* The prompt is the only required answer in the whole wizard, so
                it gets the page: eight rows, first, and nothing above it to
                read past.

                And it is the CHAT INPUT, `/` and all. A task that should run a
                playbook names it here the way a person would name it in a
                message — the model reads the name and decides. The advanced
                section used to hold a one-or-none `<Select>` instead, whose
                body the fire prompt then pasted in front of the model: the
                last mechanism in the product that could impose a skill on a
                turn, which ADR-0060 says nothing may do, "not the request, not
                the deployment, not a job". */}
            <form.AppField name="prompt">
              {(field) => (
                <FieldShell
                  label={t('builder.promptLabel')}
                  description={t('builder.promptHint')}
                  required
                  htmlFor="wizard-prompt"
                  errors={field.state.meta.isTouched ? field.state.meta.errors : []}
                >
                  <SkillPromptField
                    id="wizard-prompt"
                    value={field.state.value}
                    onChange={(next) => field.handleChange(next)}
                    onBlur={field.handleBlur}
                    placeholder={t('builder.promptPlaceholder')}
                    rows={8}
                    data-testid="wizard-prompt"
                  />
                </FieldShell>
              )}
            </form.AppField>

            {/* The name is a LABEL on a list, not a second statement of intent,
                and asking for it first asks a person to summarise something
                they have not written yet. So the placeholder shows what this
                will be called, live, and moving on fills it in — nothing is
                ever overwritten, because the fill only happens while the field
                is still empty. */}
            <form.Subscribe selector={(state) => (state.values as WizardValues).prompt}>
              {(prompt) => (
                <form.AppField name="name">
                  {(field) => (
                    <field.TextField
                      containerClassName="mt-5"
                      label={t('builder.nameLabel')}
                      placeholder={suggestName(prompt) || t('builder.namePlaceholder')}
                      description={t('builder.nameHint')}
                    />
                  )}
                </form.AppField>
              )}
            </form.Subscribe>

            <Advanced
              label={t('builder.advancedSources')}
              summary={
                selectedSources.size > 0
                  ? t('builder.sourcesSummary', { count: selectedSources.size })
                  : null
              }
            >
              {/* No skill picker: a task that should run a playbook NAMES it in
            the prompt above, with the same `/` a chat message uses. */}
              <div>
          {/* The knowledge layer is server-guaranteed on every run, so it is a
              pinned row and never a checkbox — an unchecked box you cannot
              uncheck is a lie about who is in control. */}
          <div className="border-border bg-muted flex items-start gap-2.5 rounded-lg border px-2.5 py-2">
            <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-foreground text-sm">{t('builder.knowledgeAlways')}</span>
          </div>

          <Field className="mt-3">
            <FieldLabel>{t('builder.additionalSourcesLabel')}</FieldLabel>
            <FieldDescription>{t('builder.sourcesHint')}</FieldDescription>
          </Field>

          {additionalSources === null && !sourcesError && (
            <p className="text-muted-foreground flex min-h-9 items-center text-sm">
              {t('builder.sourcesLoading')}
            </p>
          )}
          {sourcesError && (
            <p className="text-muted-foreground flex min-h-9 items-center text-sm">
              {t('builder.sourcesError')}
            </p>
          )}
          {additionalSources !== null && additionalSources.length > 0 && (
            <div className="mt-2 space-y-2">
              {additionalSources.map((source) => (
                <Field
                  key={source.id}
                  orientation="horizontal"
                  className="hover:border-border justify-start rounded-lg border border-transparent px-1 py-1.5 transition-colors duration-snap ease-out"
                >
                  <Checkbox
                    id={`schedule-source-${source.id}`}
                    checked={selectedSources.has(source.id)}
                    onCheckedChange={(value) => toggleSource(source.id, value === true)}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col gap-0.5">
                    <FieldLabel htmlFor={`schedule-source-${source.id}`} className="font-medium">
                      {source.name}
                    </FieldLabel>
                    {source.description && (
                      <FieldDescription>{source.description}</FieldDescription>
                    )}
                  </div>
                </Field>
              ))}
              {selectedSources.size === 0 && (
                <FieldDescription>{t('builder.sourcesAll')}</FieldDescription>
              )}
            </div>
          )}
        </div>
            </Advanced>
          </section>
        )}

        {step === 'schedule' && (
          <ScheduleStep
            cadence={cadence}
            onCadenceChange={(next) => {
              setCadence(next)
              setScheduleError(null)
            }}
            dueAtLocal={dueAtLocal}
            onDueAtLocalChange={(next) => {
              setDueAtLocal(next)
              setScheduleError(null)
            }}
            minDueAtLocal={minDueAtLocal}
            dueAt={effectiveDueAt}
            customCron={customCron}
            onCustomCronChange={(next) => {
              setCustomCron(next)
              setScheduleError(null)
              if (next) setCron(buildCron(parts))
            }}
            parts={parts}
            onPartsChange={(next) => {
              setParts(next)
              setScheduleError(null)
            }}
            cron={cron}
            onCronChange={(next) => {
              setCron(next)
              setScheduleError(null)
            }}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            effectiveCron={effectiveCron}
            error={scheduleError}
            locale={locale}
          />
        )}

        {step === 'review' && (
          <form.Subscribe selector={(state) => state.values as WizardValues}>
            {(values) => (
              <ReviewStep
                values={values}
                sourceCount={selectedSources.size}
                cadence={cadence}
                effectiveCron={effectiveCron}
                effectiveDueAt={effectiveDueAt}
                timezone={timezone}
                enabled={enabled}
                onEnabledChange={setEnabled}
                locale={locale}
              />
            )}
          </form.Subscribe>
        )}
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form.Subscribe
        selector={(state) =>
          [state.values as WizardValues, state.canSubmit, state.isSubmitting] as const
        }
      >
        {([values, canSubmit, isSubmitting]) => (
          <WizardNav
            step={step}
            stepIndex={stepIndex}
            blocked={step === 'task' && values.prompt.trim().length === 0}
            isSubmitting={isSubmitting}
            canSubmit={canSubmit}
            onBack={() => (stepIndex === 0 ? onCancel() : goTo(stepIndex - 1))}
            onNext={() => goTo(stepIndex + 1)}
            editing={job !== null}
            onRunAfterSave={() => {
              runAfterSaveRef.current = true
            }}
          />
        )}
      </form.Subscribe>
    </form>
  )
}
