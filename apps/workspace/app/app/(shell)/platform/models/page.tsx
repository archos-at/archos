import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformModelDefaults } from './platform-model-defaults'

export default async function PlatformModelsPage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.models.title')} subtitle={t('sections.models.subtitle')} />
      <PlatformModelDefaults />
    </div>
  )
}
