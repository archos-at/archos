import type { JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getTranslations } from '@/i18n/server'
import { settingsCopy } from '@/i18n/namespaces/settings'

export default async function SettingsSectionLoading(): Promise<JSX.Element> {
  const t = await getTranslations(settingsCopy)
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-28 rounded-xl" />
    </div>
  )
}
