'use client'

/**
 * What an office standard is. It asks only what decides how answers treat it
 * (ticket 32: „nur abfragen, was das Büro wirklich weiß und was die Geltung
 * entscheidet“): its kind, title and edition, and for a directive the
 * authority and where it decides. Everything else is optional and folded away
 * under „Weitere Angaben“. Where it applies is picked from the office's own
 * countries and subdivisions by name, never typed as a code.
 */

import { useState, type JSX } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DateInput } from '@/components/ui/date-input'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MultiSelect } from '@/components/ui/multi-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLocale, useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { EntryValues } from '@/lib/base-knowledge/wire'
import { OFFICE_WORK_KINDS } from '@/lib/base-knowledge/wire/vocab'
import { cn } from '@/lib/utils'

export interface TerritoryChoice {
  id: string
  /** Null for a country: named in the reader's language. */
  label: string | null
}

interface EntryFormProps {
  values: EntryValues
  onChange: (values: EntryValues) => void
  disabled: boolean
  /** The licence class is set here only on a proposal; a confirmed copy's changes through its own statements. */
  showLicence: boolean
  territories: readonly TerritoryChoice[]
}

/** Kinds that apply in a place by themselves; a standard applies where a law or guideline refers to it. */
const PLACED: ReadonlySet<EntryValues['kind']> = new Set(['authority_directive', 'statute'])

function useTerritoryName(): (choice: TerritoryChoice) => string {
  const { locale } = useLocale()
  const names = new Intl.DisplayNames([locale], { type: 'region' })
  return (choice) => choice.label ?? names.of(choice.id) ?? choice.id
}

function Optional({ children }: { children: string }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <>
      {children} <span className="font-normal text-muted-foreground">{t('field.optional')}</span>
    </>
  )
}

function TerritoryField({ values, set, disabled, territories, optional }: {
  values: EntryValues
  set: <K extends keyof EntryValues>(key: K, value: EntryValues[K]) => void
  disabled: boolean
  territories: readonly TerritoryChoice[]
  optional: boolean
}): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const name = useTerritoryName()
  const options = territories.map((choice) => ({ value: choice.id, label: name(choice) }))
  return (
    <Field>
      <FieldLabel>{optional ? <Optional>{t('field.territoryIds')}</Optional> : t('field.territoryIds')}</FieldLabel>
      <MultiSelect
        options={options}
        value={values.territoryIds}
        onValueChange={(ids) => set('territoryIds', ids)}
        placeholder={t('field.territoryPlaceholder')}
        label={t('field.territoryIds')}
        searchPlaceholder={t('field.territorySearch')}
        labelFor={(id) => name({ id, label: null })}
        disabled={disabled}
      />
      <FieldDescription>{t(PLACED.has(values.kind) ? 'field.territoryIdsHint' : 'field.territoryIdsHintStandard')}</FieldDescription>
    </Field>
  )
}

export function EntryForm({ values, onChange, disabled, showLicence, territories }: EntryFormProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { locale } = useLocale()
  const [more, setMore] = useState(false)
  const set = <K extends keyof EntryValues>(key: K, value: EntryValues[K]) => onChange({ ...values, [key]: value })
  const directive = values.kind === 'authority_directive'
  const placed = PLACED.has(values.kind)
  const authorityTerritory = values.territoryIds[0] ?? values.addressees[0]?.territoryId ?? null
  return (
    <div className="grid gap-4" data-testid="base-knowledge-form">
      <Field>
        <FieldLabel htmlFor="bk-kind">{t('field.kind')}</FieldLabel>
        <Select value={values.kind} disabled={disabled} onValueChange={(kind) => set('kind', kind as EntryValues['kind'])}>
          <SelectTrigger id="bk-kind" className="w-full sm:w-64">
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
        <FieldLabel htmlFor="bk-title">{t('field.title')}</FieldLabel>
        <Input id="bk-title" value={values.title} disabled={disabled} onChange={(event) => set('title', event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="bk-designation">
            <Optional>{t('field.designation')}</Optional>
          </FieldLabel>
          <Input
            id="bk-designation"
            value={values.designation ?? ''}
            disabled={disabled}
            onChange={(event) => set('designation', event.target.value.trim() ? event.target.value : null)}
          />
          <FieldDescription>{t('field.designationHint')}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="bk-edition">{t('field.editionLabel')}</FieldLabel>
          <Input id="bk-edition" value={values.editionLabel} disabled={disabled} onChange={(event) => set('editionLabel', event.target.value)} />
          <FieldDescription>{t('field.editionLabelHint')}</FieldDescription>
        </Field>
      </div>
      {placed && <TerritoryField values={values} set={set} disabled={disabled} territories={territories} optional={false} />}
      {directive && (
        <Field>
          <FieldLabel htmlFor="bk-authority">{t('field.authority')}</FieldLabel>
          <Input
            id="bk-authority"
            value={values.addressees[0]?.name ?? ''}
            disabled={disabled || authorityTerritory === null}
            onChange={(event) =>
              authorityTerritory &&
              set('addressees', event.target.value.trim() ? [{ name: event.target.value, territoryId: authorityTerritory }] : [])
            }
          />
          <FieldDescription>{t(authorityTerritory === null ? 'field.authorityNeedsTerritory' : 'field.authorityHint')}</FieldDescription>
        </Field>
      )}
      {showLicence && (
        // One question for the office: bought, or free to read? Restricted and open public copies are read alike
        // (`text-use.ts`), so the form does not ask which; a restricted copy keeps its class until someone changes it.
        <Field>
          <FieldLabel id="bk-licence">{t('field.purchased')}</FieldLabel>
          <RadioGroup
            aria-labelledby="bk-licence"
            value={values.licenceClass === 'licensed' ? 'licensed' : 'public'}
            disabled={disabled}
            onValueChange={(choice) =>
              set('licenceClass', choice === 'licensed' ? 'licensed' : values.licenceClass === 'licensed' ? 'public_open' : values.licenceClass)
            }
            className="grid gap-2"
          >
            {(['licensed', 'public'] as const).map((choice) => (
              <label key={choice} className="flex items-start gap-2 text-sm">
                <RadioGroupItem value={choice} />
                <span>
                  {t(`field.purchasedChoice.${choice}`)}
                  <span className="block text-xs text-muted-foreground">{t(`field.purchasedHint.${choice}`)}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </Field>
      )}
      <Collapsible open={more} onOpenChange={setMore}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2" data-testid="base-knowledge-more">
            {t('field.more')}
            <ChevronDown className={cn('size-4 transition-transform duration-quick', more && 'rotate-180')} aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 pt-2">
          {!placed && <TerritoryField values={values} set={set} disabled={disabled} territories={territories} optional />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="bk-issuer">
                <Optional>{t('field.issuer')}</Optional>
              </FieldLabel>
              <Input id="bk-issuer" value={values.issuer ?? ''} disabled={disabled} onChange={(event) => set('issuer', event.target.value.trim() ? event.target.value : null)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="bk-in-force">
                <Optional>{t('field.inForceFrom')}</Optional>
              </FieldLabel>
              {disabled ? (
                <Input id="bk-in-force" value={values.inForceFrom ?? ''} disabled />
              ) : (
                <DateInput
                  id="bk-in-force"
                  value={values.inForceFrom ?? ''}
                  onChange={(day) => set('inForceFrom', day || null)}
                  locale={locale}
                  tokens={{ day: t('field.dateTokens.day'), month: t('field.dateTokens.month'), year: t('field.dateTokens.year') }}
                />
              )}
              <FieldDescription>{t('field.inForceFromHint')}</FieldDescription>
            </Field>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
