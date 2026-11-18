import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformLessons } from './platform-lessons'

export default async function PlatformLessonsPage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.lessons.title')} subtitle={t('sections.lessons.subtitle')} />
      <PlatformLessons />
    </div>
  )
}
