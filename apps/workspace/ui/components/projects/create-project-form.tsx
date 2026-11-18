'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { FolderUp, Plus, X } from 'lucide-react'
import { z } from 'zod'
import { useAppForm } from '@/components/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { MonthInput } from '@/components/ui/month-input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AddressField, type AddressFieldProps, type AddressValue } from './address-field'
import { EMPTY_SITE_PLACE, SitePlaceFields, type SitePlace } from './site-place-fields'
import { toFormData, type CreateProjectState } from './create-project-form-data'
import { LEGACY_AGENT_SETUP } from '@/lib/projects/legacy-project-setup'
import { createProject } from '@/app/app/(shell)/projects/actions'
import {
  FileDropOverlay,
  useWindowDragGuard,
} from '@/features/documents/components/file-drop-overlay'
import { useFileDragDrop } from '@/features/documents/hooks/use-file-drag-drop'
import {
  discardDroppedFiles,
  handOverDroppedFiles,
  newProjectDropKey,
} from '@/features/documents/lib/dropped-file-handover'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { capturePosthog } from '@/lib/analytics/posthog'
import { MAX_INTAKE_DESCRIPTION_LENGTH } from '@/lib/project-intake/types'
import { currentMonth, isMonth, type Month } from '@/lib/projects/month'
import {
  closingBounds,
  closingProblem,
  defaultClosing,
  type ProjectOutcome,
} from '@/lib/projects/project-status'
import { isRedirectSignal } from '@/lib/utils/redirect-signal'

type AbschlussProblem = ReturnType<typeof closingProblem>

export interface CreateProjectFormProps {
  onCancel?: () => void
  addressClients?: Pick<AddressFieldProps, 'client' | 'sameAddressClient'>
  initial?: { name?: string; address?: string; description?: string }
}

const SERVER_REASONS: Readonly<Record<string, Exclude<AbschlussProblem, null>>> = {
  'abschluss-in-future': 'future',
  'abschluss-before-beginn': 'beforeStart',
}

const startedOnOf = (value: string): Month | null => (isMonth(value) ? value : null)

interface DroppedFolder {
  name: string | null
  count: number
}

export function folderNameOf(files: readonly File[]): string | null {
  const pathOf = (file: File): string => file.webkitRelativePath ?? ''
  const nested = files.find((file) => pathOf(file).includes('/'))
  if (nested) return pathOf(nested).split('/')[0] || null
  if (files.length === 1 && /\.zip$/i.test(files[0].name))
    return files[0].name.replace(/\.zip$/i, '')
  return null
}

export function CreateProjectForm({
  onCancel,
  addressClients,
  initial,
}: CreateProjectFormProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const tFiles = useTranslations(filesCopy)
  const [thisMonth] = useState(() => currentMonth())
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverAbschluss, setServerAbschluss] = useState<AbschlussProblem>(null)
  const [dropped, setDropped] = useState<DroppedFolder | null>(null)
  const [describing, setDescribing] = useState(Boolean(initial?.description))
  const [dropKey] = useState(newProjectDropKey)
  const holding = useRef(false)
  const created = useRef(false)
  const [finePointer] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia('(pointer: fine)').matches
  )

  const nameSchema = z
    .string()
    .trim()
    .min(1, t('form.nameRequired'))
    .max(255, t('form.nameTooLong'))

  const form = useAppForm({
    defaultValues: {
      name: initial?.name ?? '',
      address: { text: initial?.address ?? '', place: null } as AddressValue,
      site: EMPTY_SITE_PLACE as SitePlace,
      description: initial?.description ?? '',
      state: 'active' as CreateProjectState,
      outcome: '' as ProjectOutcome | '',
      startedOn: '',
      endedOn: defaultClosing(null, null, thisMonth) as string,
    },
    onSubmit: async ({ value }) => {
      setServerError(null)
      setServerAbschluss(null)
      created.current = true
      let result: Awaited<ReturnType<typeof createProject>>
      try {
        result = await createProject({}, toFormData(value, holding.current ? dropKey : null, LEGACY_AGENT_SETUP))
      } catch (error) {
        if (isRedirectSignal(error)) {
          capturePosthog('project_created', { state: value.state, setup: LEGACY_AGENT_SETUP })
          return
        }
        created.current = false
        console.error('[CreateProjectForm] create threw:', error)
        setServerError(t('form.createError'))
        return
      }
      if (!result?.error) {
        capturePosthog('project_created', { state: value.state, setup: LEGACY_AGENT_SETUP })
        return
      }
      created.current = false
      const reason = result.reason ? SERVER_REASONS[result.reason] : undefined
      if (reason) {
        setServerAbschluss(reason)
        return
      }
      console.error('[CreateProjectForm] create failed:', result.error)
      setServerError(t('form.createError'))
    },
  })

  useEffect(
    () => () => {
      if (!created.current) discardDroppedFiles(dropKey)
    },
    [dropKey]
  )
  function forgetDrop(): void {
    discardDroppedFiles(dropKey)
    holding.current = false
    setDropped(null)
  }

  const values = useStore(form.store, (state) => state.values)
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const closed = values.state === 'closed'
  const abschlussError =
    serverAbschluss ?? closingProblem(values.endedOn, startedOnOf(values.startedOn), thisMonth)
  const nameValid = values.name.trim().length > 0 && values.name.trim().length <= 255
  const ready = nameValid && (!closed || (values.outcome !== '' && abschlussError === null))

  const takeDrop = (files: File[]): void => {
    if (files.length === 0) return
    const folder = folderNameOf(files)
    handOverDroppedFiles(dropKey, files)
    holding.current = true
    setDropped((previous) => ({
      name: folder ?? previous?.name ?? null,
      count: (previous?.count ?? 0) + files.length,
    }))
    if (folder && form.getFieldValue('name').trim() === '') form.setFieldValue('name', folder)
  }
  const { isDragging, isUnsupportedDrag, dragHandlers } = useFileDragDrop({
    onDrop: takeDrop,
    disabled: isSubmitting,
    acceptZip: true,
  })
  useWindowDragGuard()

  return (
    <div className="relative" {...dragHandlers} data-testid="create-project-drop">
      <FileDropOverlay
        show={isDragging}
        isUnsupported={isUnsupportedDrag}
        uploadLabel={t('form.drop.overlay')}
        unsupportedLabel={tFiles('workspace.dropUnsupported')}
        testId="create-project-drop-overlay"
      />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (ready) void form.handleSubmit()
        }}
        className="flex flex-col gap-[18px]"
        noValidate
      >
        <form.AppField name="name" validators={{ onChange: nameSchema }}>
          {(field) => (
            <field.TextField
              label={t('form.nameLabel')}
              placeholder={t('form.namePlaceholder')}
              autoFocus={finePointer}
              autoComplete="off"
              disabled={isSubmitting}
            />
          )}
        </form.AppField>

        <form.Field name="address">
          {(address) => (
            <AddressField
              value={address.state.value}
              onChange={address.handleChange}
              disabled={isSubmitting}
              {...addressClients}
            />
          )}
        </form.Field>

        {/* A chosen hit knows its Land; the picker is for a typed address. */}
        {!values.address.place && (
          <form.Field name="site">
            {(site) => (
              <SitePlaceFields value={site.state.value} onChange={site.handleChange} disabled={isSubmitting} />
            )}
          </form.Field>
        )}

        {/* The state and what a closed project adds stay one block, so the
            folded part costs no gap of its own while it is shut. */}
        <div className="flex flex-col">
          <form.Field name="state">
            {(field) => (
              <Field>
                <FieldLabel id="create-project-state-label">{t('form.state.label')}</FieldLabel>
                <Segmented
                  value={field.state.value}
                  onChange={(next) => field.handleChange(next === 'closed' ? 'closed' : 'active')}
                  labelledBy="create-project-state-label"
                  disabled={isSubmitting}
                  options={[
                    { value: 'active', label: t('form.state.active') },
                    { value: 'closed', label: t('form.state.closed') },
                  ]}
                />
              </Field>
            )}
          </form.Field>

          <Collapsible open={closed}>
            <CollapsibleContent>
              <FieldGroup className="gap-[18px] pt-[18px]" data-testid="create-project-closed">
                <form.Field name="outcome">
                  {(field) => (
                    <OutcomeField
                      value={field.state.value}
                      onChange={(next) => field.handleChange(next)}
                      disabled={isSubmitting}
                    />
                  )}
                </form.Field>
                <PeriodFields
                  startedOn={values.startedOn}
                  endedOn={values.endedOn}
                  thisMonth={thisMonth}
                  problem={abschlussError}
                  disabled={isSubmitting}
                  onStartedOn={(next) => {
                    setServerAbschluss(null)
                    form.setFieldValue('startedOn', next)
                  }}
                  onEndedOn={(next) => {
                    setServerAbschluss(null)
                    form.setFieldValue('endedOn', next)
                  }}
                />
                <p
                  className="text-muted-foreground text-xs"
                  data-testid="create-project-closed-note"
                >
                  {t('form.closed.readOnlyAgent')}
                </p>
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <FolderZone
          dropped={dropped}
          finePointer={finePointer}
          disabled={isSubmitting}
          onPick={takeDrop}
          onRemove={forgetDrop}
        />

        {/* „Worum geht es?" helps the reading but is never needed to begin:
            folded behind a line until someone wants to write it. */}
        <Collapsible open={describing}>
          {!describing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDescribing(true)}
              disabled={isSubmitting}
              className="text-muted-foreground hover:text-foreground -mx-2 h-8 self-start px-2 text-[13px] font-normal hover:bg-transparent"
              data-testid="create-project-describe"
            >
              <Plus className="size-3.5" aria-hidden />
              {t('form.description.open')}
            </Button>
          )}
          <CollapsibleContent>
            <form.AppField
              name="description"
              validators={{ onChange: z.string().max(MAX_INTAKE_DESCRIPTION_LENGTH) }}
            >
              {(field) => (
                <field.TextAreaField
                  label={t('form.description.label')}
                  description={t('form.description.help')}
                  placeholder={t('form.description.placeholder')}
                  maxLength={MAX_INTAKE_DESCRIPTION_LENGTH}
                  rows={3}
                  autoFocus={!initial?.description}
                  disabled={isSubmitting}
                />
              )}
            </form.AppField>
          </CollapsibleContent>
        </Collapsible>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {/* On a phone `DialogContent` pins the footer to the bottom edge while
            the fields scroll. Cancel and the action share one row (the action
            takes the width) so the bar costs one button's height. */}
        <DialogFooter className="mt-2 gap-2.5 max-sm:flex-row max-sm:items-center max-sm:[&>:last-child]:flex-1">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isSubmitting}
              className="h-10 px-4"
            >
              {t('form.cancel')}
            </Button>
          )}
          <form.AppForm>
            <form.SubmitButton disabled={!ready} className="h-10 px-[18px]">
              {t('form.submit')}
            </form.SubmitButton>
          </form.AppForm>
        </DialogFooter>
      </form>
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options,
  labelledBy,
  disabled,
  required,
}: {
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  labelledBy: string
  disabled: boolean
  required?: boolean
}): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      segmented
      variant="outline"
      value={value}
      onValueChange={(next: string) => {
        if (next) onChange(next)
      }}
      aria-labelledby={labelledBy}
      aria-required={required}
      disabled={disabled}
      className="bg-muted gap-0.5 border-transparent p-[3px] shadow-none"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="h-[34px] border-0 px-4 shadow-none data-[state=off]:font-normal data-[state=on]:shadow-none"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function FolderZone({
  dropped,
  finePointer,
  disabled,
  onPick,
  onRemove,
}: {
  dropped: DroppedFolder | null
  finePointer: boolean
  disabled: boolean
  onPick: (files: File[]) => void
  onRemove: () => void
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      className="border-border bg-muted/40 flex items-center gap-3.5 rounded-surface border-[1.5px] border-dashed px-[18px] py-4 max-sm:px-4"
      data-testid={dropped ? 'create-project-dropped' : 'create-project-folder-zone'}
    >
      <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-control">
        <FolderUp className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {dropped ? (
          <p className="text-sm font-medium">
            {dropped.name
              ? t('form.drop.held', { name: dropped.name, count: dropped.count })
              : t('form.drop.heldNoName', { count: dropped.count })}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium">
              {finePointer ? t('form.drop.title') : t('form.drop.titleTouch')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t('form.drop.help')}</p>
          </>
        )}
      </div>
      {dropped ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('form.drop.remove')}
          title={t('form.drop.remove')}
        >
          <X aria-hidden />
        </Button>
      ) : (
        <>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            {...(finePointer
              ? ({ webkitdirectory: '', directory: '' } as Record<string, string>)
              : {})}
            onChange={(event) => {
              onPick(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
            data-testid="create-project-folder-input"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={disabled}
            className="bg-card h-[34px] px-3 text-[13px]"
          >
            {t('form.drop.choose')}
          </Button>
        </>
      )}
    </div>
  )
}

function OutcomeField({
  value,
  onChange,
  disabled,
}: {
  value: ProjectOutcome | ''
  onChange: (value: ProjectOutcome) => void
  disabled: boolean
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  return (
    <Field>
      <FieldLabel id="create-project-outcome-label">
        {t('lifecycle.closeDialog.outcome.label')}
      </FieldLabel>
      {/* Chosen, never preselected: a default would nudge the record. */}
      <Segmented
        value={value}
        onChange={(next) => onChange(next === 'cancelled' ? 'cancelled' : 'completed')}
        labelledBy="create-project-outcome-label"
        required
        disabled={disabled}
        options={[
          { value: 'completed', label: t('lifecycle.outcome.completed') },
          { value: 'cancelled', label: t('lifecycle.outcome.cancelled') },
        ]}
      />
      {value !== '' && (
        <FieldDescription>{t(`lifecycle.closeDialog.outcome.${value}Hint`)}</FieldDescription>
      )}
    </Field>
  )
}

interface PeriodFieldsProps {
  startedOn: string
  endedOn: string
  thisMonth: Month
  problem: AbschlussProblem
  disabled: boolean
  onStartedOn: (value: string) => void
  onEndedOn: (value: string) => void
}

function PeriodFields({
  startedOn,
  endedOn,
  thisMonth,
  problem,
  disabled,
  onStartedOn,
  onEndedOn,
}: PeriodFieldsProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const { locale } = useLocale()
  const bounds = closingBounds(startedOnOf(startedOn), thisMonth)
  const placeholder = { month: t('projectRecord.month'), year: t('projectRecord.year') }
  const problemCopy =
    problem === 'beforeStart'
      ? t('form.closed.endedOnBeforeStart')
      : problem
        ? t(`lifecycle.closeDialog.endedOn.${problem}`)
        : null

  return (
    <div className="grid grid-cols-1 gap-[18px]">
      <Field>
        <FieldLabel htmlFor="create-project-started-on">
          {t('form.closed.startedOn')}
          <span className="text-muted-foreground font-normal">({t('form.closed.optional')})</span>
        </FieldLabel>
        <MonthInput
          id="create-project-started-on"
          value={startedOn}
          onChange={onStartedOn}
          locale={locale}
          monthLabel={`${t('form.closed.startedOn')}, ${t('projectRecord.month')}`}
          yearLabel={`${t('form.closed.startedOn')}, ${t('projectRecord.year')}`}
          placeholder={placeholder}
          clearLabel={t('form.closed.clearStartedOn')}
          toYear={Number(thisMonth.slice(0, 4))}
          disabled={disabled}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="create-project-ended-on">
          {t('lifecycle.closeDialog.endedOn.label')}
        </FieldLabel>
        <MonthInput
          id="create-project-ended-on"
          value={endedOn}
          onChange={onEndedOn}
          locale={locale}
          monthLabel={`${t('lifecycle.closeDialog.endedOn.label')}, ${t('projectRecord.month')}`}
          yearLabel={`${t('lifecycle.closeDialog.endedOn.label')}, ${t('projectRecord.year')}`}
          placeholder={placeholder}
          fromYear={bounds.min ? Number(bounds.min.slice(0, 4)) : undefined}
          toYear={Number(bounds.max.slice(0, 4))}
          invalid={problem !== null}
          disabled={disabled}
        />
        {problemCopy && <FieldError id="create-project-ended-on-error">{problemCopy}</FieldError>}
      </Field>
    </div>
  )
}
