import type { JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'

// Keyed per place under the head the project's layout keeps: a switch answers at once in the content alone.
export default async function AblagePlaceLoading(): Promise<JSX.Element> {
  const t = await getTranslations(commonCopy)
  return (
    <div className="listing-container flex flex-col gap-3 px-4 pt-6 md:px-8" aria-busy="true" data-testid="ablage-place-loading">
      <span className="sr-only" role="status">
        {t('states.loading')}
      </span>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-2/3" />
    </div>
  )
}
