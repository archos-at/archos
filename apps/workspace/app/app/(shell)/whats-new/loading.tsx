import type { JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ShellContent } from '@/components/shell'
import { WeekEntry, WeekTimeline } from '@/features/whats-new/components'
import { getTranslations } from '@/i18n/server'
import { whatsNewCopy } from '@/i18n/namespaces/whats-new'

/** Route-level loading state, in the page's own shapes, so the arrival from the user menu shows at once. */
export default async function WhatsNewLoading(): Promise<JSX.Element> {
  const t = await getTranslations(whatsNewCopy)
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
      <Skeleton className="mb-8 h-8 w-full max-w-xl rounded-full" />
      <WeekTimeline>
        {Array.from({ length: 3 }).map((_, i) => (
          <WeekEntry key={i} rail={<Skeleton className="h-6 w-36" />}>
            <Skeleton className="h-4 w-full max-w-prose" />
            <Skeleton className="h-4 w-4/5 max-w-prose" />
            <Skeleton className="h-4 w-32" />
          </WeekEntry>
        ))}
      </WeekTimeline>
    </ShellContent>
  )
}
