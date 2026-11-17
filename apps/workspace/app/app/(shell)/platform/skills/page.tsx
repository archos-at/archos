import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformSkillCatalog } from './platform-skill-catalog'

export default async function PlatformSkillsPage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.skills.title')} subtitle={t('sections.skills.subtitle')} />
      <PlatformSkillCatalog />
    </div>
  )
}
