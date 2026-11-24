import type { JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'

export default async function OfficeLibraryLoading(): Promise<JSX.Element> {
  const t = await getTranslations(commonCopy)
  return (
    <div className="listing-container flex flex-col gap-6 px-4 py-4 md:px-8" aria-busy="true">
      <span className="sr-only" role="status">
        {t('states.loading')}
      </span>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
