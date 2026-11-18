import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformCards } from './platform-cards'

export default async function PlatformCardsPage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.cards.title')} subtitle={t('sections.cards.subtitle')} />
      <PlatformCards />
    </div>
  )
}
