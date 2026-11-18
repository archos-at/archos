import type { JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ShellContent } from '@/components/shell'
import { getTranslations } from '@/i18n/server'
import { profileCopy } from '@/i18n/namespaces/profile'

export default async function ProfileLoading(): Promise<JSX.Element> {
  const t = await getTranslations(profileCopy)
  return (
    <ShellContent aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>

      <Skeleton className="mb-6 h-6 w-28 rounded-full" />

      <div className="mb-8 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex flex-col gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    </ShellContent>
  )
}
