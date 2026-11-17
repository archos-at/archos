import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { CountryKnowledge } from '@/features/platform/components/country-knowledge'

export default async function PlatformCountriesPage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.countries.title')} subtitle={t('sections.countries.subtitle')} />
      <CountryKnowledge />
    </div>
  )
}
