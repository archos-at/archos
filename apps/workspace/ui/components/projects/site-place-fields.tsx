'use client'

import type { JSX } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { SITE_SUBDIVISIONS } from '@/lib/project-profile/intake-stages/project-basis'

export const SITE_COUNTRIES = ['at', 'de', 'ch', 'other'] as const

export interface SitePlace {
  country: string
  federalState: string
}

export const EMPTY_SITE_PLACE: SitePlace = { country: '', federalState: '' }

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
  const subdivided = value.country === SITE_SUBDIVISIONS.country
  return (
    <Field data-testid="create-project-site">
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="create-project-country">{t('form.site.countryLabel')}</FieldLabel>
          <Select
            value={value.country || UNSET}
            onValueChange={(next) =>
              onChange({ country: next === UNSET ? '' : next, federalState: next === SITE_SUBDIVISIONS.country ? value.federalState : '' })
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
            onValueChange={(next) => onChange({ country: SITE_SUBDIVISIONS.country, federalState: next === UNSET ? '' : next })}
            disabled={disabled || !subdivided}
          >
            <SelectTrigger id="create-project-federal-state" data-testid="create-project-federal-state">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>{t('form.site.fromPostalCode')}</SelectItem>
              {SITE_SUBDIVISIONS.options.map((state) => (
                <SelectItem key={state.token} value={state.token}>
                  {t(`form.site.state.${state.token}` as Parameters<typeof t>[0])}
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

export function setSitePlace(formData: FormData, value: SitePlace): void {
  if (value.country) formData.set('country', value.country)
  if (value.country === SITE_SUBDIVISIONS.country && value.federalState) formData.set('federal_state', value.federalState)
}
