import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformRetrievalSettings } from './platform-retrieval-settings'

export default async function PlatformRetrievalPage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.retrieval.title')} subtitle={t('sections.retrieval.subtitle')} />
      <PlatformRetrievalSettings />
    </div>
  )
}
