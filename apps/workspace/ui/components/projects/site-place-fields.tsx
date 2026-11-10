'use client'

/**
 * Where the new project is: its country first, then, in Austria, its
 * Bundesland. Both optional, neither preselected.
 *
 * The site decides which law applies (ADR-0158), and with address search off
 * (ADR-0159) a typed address no longer places a project by itself. Left empty,
 * an Austrian postal code in the address suggests the Land for the person to
 * confirm on the setup page; the picker is for the rest, and for saying the
 * project is abroad. Nothing here reads the office's own country: an Austrian
 * office plans in Bavaria too.
 *
 * Shown beside the address field, never in its place: the address field once
 * turned into a Bundesland select and lost what the person had typed
 * (`address-field.tsx`).
 */

import type { JSX } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'

/** The A2_country tokens, in the order the picker lists them. */
export const SITE_COUNTRIES = ['at', 'de', 'ch', 'other'] as const
/** The A2_land tokens of Austria's nine Länder. */
export const AUSTRIAN_STATES = [
  'vienna',
  'lower_austria',
  'upper_austria',
  'styria',
  'carinthia',
  'salzburg',
  'tyrol',
  'vorarlberg',
  'burgenland',
] as const

export interface SitePlace {
  /** An A2_country token, or '' while none is chosen. */
  country: string
  /** An A2_land token, or '' while none is chosen; only in Austria. */
  federalState: string
}

export const EMPTY_SITE_PLACE: SitePlace = { country: '', federalState: '' }

/** Radix's Select has no empty item; this one stands for "not stated". */
const UNSET = 'unset'

export function SitePlaceFields({
  value,
  onChange,
  disabled,
}: {
  value: SitePlace
  onChange: (next: SitePlace) => void
  disabled: boolean
}): JSX.Element {
  const t = useTranslations(projectsCopy)
  const austria = value.country === 'at'
  return (
    <Field data-testid="create-project-site">
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="create-project-country">{t('form.site.countryLabel')}</FieldLabel>
          <Select
            value={value.country || UNSET}
            onValueChange={(next) =>
              onChange({ country: next === UNSET ? '' : next, federalState: next === 'at' ? value.federalState : '' })
            }
            disabled={disabled}
          >
            <SelectTrigger id="create-project-country" data-testid="create-project-country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>{t('form.site.unset')}</SelectItem>
              {SITE_COUNTRIES.map((country) => (
                <SelectItem key={country} value={country}>
                  {t(`form.site.country.${country}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="create-project-federal-state">{t('form.site.federalStateLabel')}</FieldLabel>
          <Select
            value={value.federalState || UNSET}
            onValueChange={(next) => onChange({ country: 'at', federalState: next === UNSET ? '' : next })}
            disabled={disabled || !austria}
          >
            <SelectTrigger id="create-project-federal-state" data-testid="create-project-federal-state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>{t('form.site.fromPostalCode')}</SelectItem>
              {AUSTRIAN_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {t(`form.site.state.${state}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <FieldDescription>{t('form.site.help')}</FieldDescription>
    </Field>
  )
}

/** The action's fields for a chosen place: nothing for what was left empty. */
export function setSitePlace(formData: FormData, value: SitePlace): void {
  if (value.country) formData.set('country', value.country)
  if (value.country === 'at' && value.federalState) formData.set('federal_state', value.federalState)
}
