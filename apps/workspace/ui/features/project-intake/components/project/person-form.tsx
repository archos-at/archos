'use client'

import { useId, useState, type FormEvent, type JSX } from 'react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useTranslations } from '@/i18n'
import { intakeProjectStepCopy } from '@/i18n/namespaces/intake-project-step'

export interface PersonDraft {
  name: string
  function: string
  company: string
}

const COMMON_FUNCTIONS = ['client', 'lead', 'structural', 'physics', 'mep', 'electrical', 'fire', 'survey', 'supervision'] as const

export function FunctionField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}): JSX.Element {
  const t = useTranslations(intakeProjectStepCopy)
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('people.function')}</FieldLabel>
      <Input
        id={id}
        maxLength={200}
        autoFocus={autoFocus}
        placeholder={t('people.functionPlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div role="group" aria-label={t('people.functionsLabel')} className="flex flex-wrap gap-1.5">
        {COMMON_FUNCTIONS.map((key) => {
          const label = t(`people.functions.${key}`)
          return (
            <Chip key={key} asChild size="sm" variant={value === label ? 'default' : 'outline'} interactive>
              <button data-attr="intake-change" type="button" aria-pressed={value === label} onClick={() => onChange(label)}>
                {label}
              </button>
            </Chip>
          )
        })}
      </div>
    </Field>
  )
}

export function PersonForm({
  initial,
  fixedName,
  busy,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
}: {
  initial: PersonDraft
  fixedName: string | null
  busy: boolean
  submitLabel: string
  busyLabel: string
  onSubmit: (draft: PersonDraft) => void
  onCancel: () => void
}): JSX.Element {
  const t = useTranslations(intakeProjectStepCopy)
  const id = useId()
  const [draft, setDraft] = useState(initial)
  const set = (key: keyof PersonDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const named = draft.name.trim().length > 0

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!named || busy) return
    onSubmit(draft)
  }

  return (
    <form className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2" onSubmit={submit} aria-label={fixedName ?? t('people.addExternal')}>
      {fixedName ? (
        <p className="text-sm font-medium sm:col-span-2">{fixedName}</p>
      ) : (
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`${id}-name`}>{t('people.name')}</FieldLabel>
          <Input id={`${id}-name`} required maxLength={200} autoFocus value={draft.name} onChange={(event) => set('name')(event.target.value)} />
        </Field>
      )}
      <div className="sm:col-span-2">
        <FunctionField value={draft.function} onChange={set('function')} autoFocus={Boolean(fixedName)} />
      </div>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${id}-company`}>{t('people.company')}</FieldLabel>
        <Input id={`${id}-company`} maxLength={200} value={draft.company} onChange={(event) => set('company')(event.target.value)} />
      </Field>
      <div className="flex flex-col-reverse gap-2 pt-1 sm:col-span-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('people.cancel')}
        </Button>
        <BusyButton type="submit" busy={busy} busyLabel={busyLabel} disabled={!named}>
          {submitLabel}
        </BusyButton>
      </div>
    </form>
  )
}
