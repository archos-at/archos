import type { JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { THREAD_COLUMN, THREAD_GUTTER } from '@/components/ui/thread-column'
import { getTranslations } from '@/i18n/server'
import { projectsCopy } from '@/i18n/namespaces/projects'

export default async function ProjectChatLoading(): Promise<JSX.Element> {
  const t = await getTranslations(projectsCopy)
  return (
    <div
      className="bg-background animate-in fade-in-0 duration-quick ease-out motion-reduce:animate-none flex min-h-0 flex-1 flex-col justify-end"
      aria-busy="true"
      data-slot="chat-loading"
    >
      <span className="sr-only" role="status">
        {t('section.loading')}
      </span>
      <div className={`${THREAD_COLUMN} ${THREAD_GUTTER} pb-6`}>
        <Skeleton className="h-[104px] w-full rounded-2xl" />
      </div>
    </div>
  )
}
