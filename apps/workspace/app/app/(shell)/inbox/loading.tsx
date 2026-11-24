import type { JSX } from 'react'
import { ShellContent } from '@/components/shell'
import { Skeleton } from '@/components/ui/skeleton'
import { InboxQueueSkeleton } from '@/features/collaboration/components/InboxSkeleton'
import { getTranslations } from '@/i18n/server'
import { commonCopy } from '@/i18n/namespaces/common'

export default async function InboxLoading(): Promise<JSX.Element> {
  const t = await getTranslations(commonCopy)
  return (
    <ShellContent width="tool" fill aria-busy="true">
      <span className="sr-only" role="status">
        {t('states.loading')}
      </span>
      <Skeleton className="mb-6 h-6 w-28 rounded-full" />
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="mb-4 h-8 w-72 max-w-full rounded-control" />
      <div className="max-w-md">
        <InboxQueueSkeleton />
      </div>
    </ShellContent>
  )
}
