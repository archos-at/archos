'use client'

/**
 * What an office standard is: kind, designation, title, edition, where it
 * applies, a directive's authority and, while it is a proposal, its licence.
 * Every field says what it is for in the field's own hint, and the kind says
 * how answers will treat it, because that is the consequence a person confirms.
 */

import type { JSX } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { EntryValues } from '@/lib/base-knowledge/wire'
import { LICENCE_CLASSES, OFFICE_WORK_KINDS } from '@/lib/base-knowledge/wire/vocab'

interface EntryFormProps {
  values: EntryValues
  onChange: (values: EntryValues) => void
  disabled: boolean
  /** The licence class is set here only on a proposal; a confirmed copy's changes through its own statements. */
  showLicence: boolean
}

const territoriesOf = (text: string) =>
  text
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)

export function EntryForm({
  values,
  onChange,
  disabled,
  showLicence,
}: EntryFormProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const set = <K extends keyof EntryValues>(key: K, value: EntryValues[K]) =>
    onChange({ ...values, [key]: value })
  const authority = values.addressees[0]?.name ?? ''
  // An authority decides somewhere: the directive's territory, which the person states first.
  const authorityTerritory = values.territoryIds[0] ?? values.addressees[0]?.territoryId ?? null
  return (
    <div className="grid gap-4" data-testid="base-knowledge-form">
      <Field>
        <FieldLabel htmlFor="bk-kind">{t('field.kind')}</FieldLabel>
        <Select
          value={values.kind}
          disabled={disabled}
          onValueChange={(kind) => set('kind', kind as EntryValues['kind'])}
        >
          <SelectTrigger id="bk-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OFFICE_WORK_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`kind.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t(`kindHint.${values.kind}`)}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="bk-designation">{t('field.designation')}</FieldLabel>
        <Input
          id="bk-designation"
          value={values.designation ?? ''}
          disabled={disabled}
          onChange={(event) =>
            set('designation', event.target.value.trim() ? event.target.value : null)
          }
        />
        <FieldDescription>{t('field.designationHint')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="bk-title">{t('field.title')}</FieldLabel>
        <Input
          id="bk-title"
          value={values.title}
          disabled={disabled}
          onChange={(event) => set('title', event.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="bk-edition">{t('field.editionLabel')}</FieldLabel>
          <Input
            id="bk-edition"
            value={values.editionLabel}
            disabled={disabled}
            onChange={(event) => set('editionLabel', event.target.value)}
          />
          <FieldDescription>{t('field.editionLabelHint')}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="bk-territories">{t('field.territoryIds')}</FieldLabel>
          <Input
            id="bk-territories"
            defaultValue={values.territoryIds.join(', ')}
            disabled={disabled}
            onBlur={(event) => set('territoryIds', territoriesOf(event.target.value))}
          />
          <FieldDescription>{t('field.territoryIdsHint')}</FieldDescription>
        </Field>
      </div>
      {values.kind === 'authority_directive' && (
        <Field>
          <FieldLabel htmlFor="bk-authority">{t('field.authority')}</FieldLabel>
          <Input
            id="bk-authority"
            value={authority}
            disabled={disabled || authorityTerritory === null}
            onChange={(event) =>
              authorityTerritory &&
              set(
                'addressees',
                event.target.value.trim()
                  ? [{ name: event.target.value, territoryId: authorityTerritory }]
                  : []
              )
            }
          />
          <FieldDescription>
            {t(
              authorityTerritory === null ? 'field.authorityNeedsTerritory' : 'field.authorityHint'
            )}
          </FieldDescription>
        </Field>
      )}
      {showLicence && (
        <Field>
          <FieldLabel htmlFor="bk-licence">{t('field.licenceClass')}</FieldLabel>
          <Select
            value={values.licenceClass}
            disabled={disabled}
            onValueChange={(licence) => set('licenceClass', licence as EntryValues['licenceClass'])}
          >
            <SelectTrigger id="bk-licence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LICENCE_CLASSES.map((licence) => (
                <SelectItem key={licence} value={licence}>
                  {t(`licence.${licence}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  )
}
