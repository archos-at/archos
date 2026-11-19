'use client'

import type { JSX } from 'react'
import { useId } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

export type SaveMode = 'own' | 'revision'

export const MAX_CHANGE_NOTE_CHARS = 500

export function SaveModeChoice({
  revisionOf,
  value,
  onChange,
  disabled,
}: {
  revisionOf: string
  value: SaveMode
  onChange: (mode: SaveMode) => void
  disabled: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const id = useId()
  const options: readonly { mode: SaveMode; label: string }[] = [
    { mode: 'own', label: t('saveTo.asOwnFile') },
    { mode: 'revision', label: t('saveTo.asRevision', { name: revisionOf }) },
  ]
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as SaveMode)}
      aria-label={t('saveTo.howToFile')}
      disabled={disabled}
      className="gap-2.5"
      data-testid="save-to-project-mode"
    >
      {options.map((option) => (
        <div key={option.mode} className="flex items-start gap-2 pointer-coarse:min-h-11">
          <RadioGroupItem
            id={`${id}-${option.mode}`}
            value={option.mode}
            className="mt-0.5"
            data-testid={`save-to-project-mode-${option.mode}`}
          />
          <Label htmlFor={`${id}-${option.mode}`} className="text-foreground text-sm font-normal">
            {option.label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  )
}

export function ChangeNoteField({
  revisionOf,
  value,
  onChange,
  disabled,
}: {
  revisionOf: string
  value: string
  onChange: (note: string) => void
  disabled: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div className="flex flex-col gap-3" data-revision-of={revisionOf}>
      <Field>
        <FieldLabel htmlFor="save-to-project-change-note">{t('saveTo.changeNote')}</FieldLabel>
        <Textarea
          id="save-to-project-change-note"
          value={value}
          maxLength={MAX_CHANGE_NOTE_CHARS}
          rows={2}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          data-testid="save-to-project-change-note"
        />
        <FieldDescription>{t('saveTo.changeNoteHint')}</FieldDescription>
      </Field>
    </div>
  )
}
