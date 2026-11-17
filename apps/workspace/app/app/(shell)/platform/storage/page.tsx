import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/features/platform/components/section-card'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformStorageTable } from '../storage-table'

export default async function PlatformStoragePage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.storage.title')} subtitle={t('sections.storage.subtitle')} />
      <SectionCard
        title={t('storage.title')}
        description={t('storage.description')}
        testId="platform-storage-card"
      >
        <PlatformStorageTable />
      </SectionCard>
    </div>
  )
}
