'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { MessagesSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadError } from '@/components/ui/load-error'
import { LoadMore } from '@/components/ui/load-more'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import { cn } from '@/lib/utils'
import {
  isActiveFeedbackCase,
  type OwnProductFeedbackListResponse,
  type OwnProductFeedbackSummary,
} from '@/lib/product-feedback/types'
import { FIT_VIEWPORT } from '../feedback-form'
import type { FeedbackScope, FeedbackThreadsApi, Load } from '../../lib/feedback-threads-api'
import { CaseGroup } from './case-rows'

const byActivity = (a: OwnProductFeedbackSummary, b: OwnProductFeedbackSummary): number =>
  b.lastActivityAt.localeCompare(a.lastActivityAt)

export function CaseList({
  scope,
  api,
  selectedId,
  onSelect,
  onNewFeedback,
  onUpdatedCount,
  onCanViewOffice,
}: {
  scope: FeedbackScope
  api: FeedbackThreadsApi
  selectedId: string | null
  onSelect: (id: string) => void
  onNewFeedback: () => void
  onUpdatedCount?: (count: number) => void
  onCanViewOffice?: (can: boolean) => void
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const [load, setLoad] = React.useState<Load<OwnProductFeedbackListResponse>>({ kind: 'loading' })
  const [more, setMore] = React.useState<{ loading: boolean; failed: boolean }>({ loading: false, failed: false })
  const office = scope === 'office'
  const read = office ? api.office : api.list

  const reload = React.useCallback(async () => {
    setLoad({ kind: 'loading' })
    try {
      const value = await read()
      setLoad({ kind: 'ready', value })
      onUpdatedCount?.(value.updatedCount)
      onCanViewOffice?.(value.canViewOffice)
    } catch {
      setLoad({ kind: 'error' })
    }
  }, [read, onUpdatedCount, onCanViewOffice])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const loadMore = async (): Promise<void> => {
    if (load.kind !== 'ready' || !load.value.nextCursor || more.loading) return
    setMore({ loading: true, failed: false })
    try {
      const page = await read(load.value.nextCursor)
      setLoad({
        kind: 'ready',
        value: { ...page, reports: [...load.value.reports, ...page.reports], updatedCount: load.value.updatedCount },
      })
      setMore({ loading: false, failed: false })
    } catch {
      setMore({ loading: false, failed: true })
    }
  }

  if (load.kind === 'loading') {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (load.kind === 'error') {
    return (
      <div className="p-4">
        <LoadError title={office ? t('threads.officeLoadError') : t('threads.loadError')} onRetry={reload} />
      </div>
    )
  }
  if (load.value.reports.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={MessagesSquare}
          title={office ? t('threads.officeEmpty.title') : t('threads.empty.title')}
          description={office ? t('threads.officeEmpty.description') : t('threads.empty.description')}
          action={office ? undefined : <Button onClick={onNewFeedback}>{t('threads.send')}</Button>}
        />
      </div>
    )
  }
  const active = load.value.reports.filter((report) => isActiveFeedbackCase(report.status)).sort(byActivity)
  const done = load.value.reports.filter((report) => !isActiveFeedbackCase(report.status)).sort(byActivity)
  const group = (label: string, reports: OwnProductFeedbackSummary[], testId: string): JSX.Element => (
    <CaseGroup label={label} reports={reports} scope={scope} selectedId={selectedId} onSelect={onSelect} testId={testId} />
  )
  return (
    <ScrollArea className={cn('min-h-0 flex-1', FIT_VIEWPORT)}>
      <div className="flex flex-col gap-5 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {active.length > 0 && group(t('threads.groups.active'), active, 'active')}
        {done.length > 0 && group(t('threads.groups.done'), done, 'done')}
        <LoadMore
          hasMore={load.value.nextCursor !== null}
          loading={more.loading}
          failed={more.failed}
          onLoadMore={() => void loadMore()}
          loadMoreLabel={t('threads.loadMore')}
          loadingLabel={t('threads.loadingMore')}
          failedLabel={t('threads.loadMoreFailed')}
        />
      </div>
    </ScrollArea>
  )
}
