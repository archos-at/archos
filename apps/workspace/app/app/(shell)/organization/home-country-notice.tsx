'use client'

/**
 * The notice an admin sees while the organization has no home country
 * (ADR-0158): a dashboard-made organization, or one from before migration
 * 0200's backfill reached it. It states the country once, through the settings
 * route the `organization-settings-update` operation also calls.
 */

import { type JSX, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { onboardingCopy } from '@/i18n/namespaces/onboarding'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { HOME_COUNTRIES, type HomeCountry } from '@/lib/organizations/home-country'

export function HomeCountryNotice(): JSX.Element {
  const t = useTranslations(organizationCopy)
  const tOnboarding = useTranslations(onboardingCopy)
  const router = useRouter()
  const [country, setCountry] = useState<HomeCountry | ''>('')
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    if (!country) return
    setSaving(true)
    try {
      const response = await fetch('/api/organization/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeCountry: country }),
      })
      if (!response.ok) throw new Error(`Save failed (${response.status})`)
      router.refresh()
    } catch {
      toast.error(t('overview.homeCountryMissing.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Alert data-testid="home-country-missing">
      <MapPin aria-hidden />
      <AlertTitle>{t('overview.homeCountryMissing.title')}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{t('overview.homeCountryMissing.description')}</span>
        <span className="flex flex-wrap items-center gap-2">
          <Select value={country} onValueChange={(next) => setCountry(next as HomeCountry)} disabled={saving}>
            <SelectTrigger className="w-56" aria-label={t('overview.homeCountry')}>
              <SelectValue placeholder={t('overview.homeCountryMissing.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {HOME_COUNTRIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {tOnboarding(`form.homeCountries.${code}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" onClick={() => void save()} disabled={!country || saving}>
            {t('overview.homeCountryMissing.save')}
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}
