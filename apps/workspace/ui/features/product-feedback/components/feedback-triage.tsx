'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { CloudOff, MessageSquarePlus, SearchX, UserRoundX } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionCard } from '@/features/platform/components/section-card'
import { useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import {
  fetchPlatformFeedback,
  fetchPlatformFeedbackReport,
  triagePlatformFeedback,
  claimPlatformFeedbackTicket,
  type ListFeedbackFilters,
} from '@/lib/product-feedback/client'
import {
  ACTIVE_SUPPORT_TICKET_STATUSES,
  PRODUCT_FEEDBACK_KINDS,
  SUPPORT_TICKET_STATUSES,
  type ProductFeedbackAssigneeFilter,
  type ProductFeedbackKind,
  type ProductFeedbackListResponse,
  type ProductFeedbackReportView,
  type ProductFeedbackStatusFilter,
  type SupportTicketStatus,
} from '@/lib/product-feedback/types'
import { ReportRow } from './feedback-triage/report-row'
import { StatusFilterChip } from './feedback-triage/status-filter-chip'

export interface FeedbackTriageClient {
  list: (filters: ListFeedbackFilters) => Promise<ProductFeedbackListResponse>
  get: (id: string) => Promise<ProductFeedbackReportView | null>
  triage: (id: string, status: SupportTicketStatus) => Promise<ProductFeedbackReportView>
  claim?: (ticketId: string) => Promise<ProductFeedbackReportView>
}

const defaultClient: FeedbackTriageClient = {
  list: fetchPlatformFeedback,
  get: fetchPlatformFeedbackReport,
  triage: triagePlatformFeedback,
  claim: claimPlatformFeedbackTicket,
}

type StatusFilter = ProductFeedbackStatusFilter | 'all'
type KindFilter = ProductFeedbackKind | 'all'
type AssigneeFilter = ProductFeedbackAssigneeFilter | 'all'

const ASSIGNEE_FILTERS: readonly AssigneeFilter[] = ['all', 'mine', 'unassigned']

export interface FeedbackTriageProps {
  canTriage: boolean
  focusReportId?: string | null
  claimTicketId?: string | null
  client?: FeedbackTriageClient
}

export function FeedbackTriage({
  canTriage,
  focusReportId = null,
  claimTicketId = null,
  client = defaultClient,
}: FeedbackTriageProps): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const [status, setStatus] = React.useState<StatusFilter>('active')
  const [kind, setKind] = React.useState<KindFilter>('all')
  const [assignee, setAssignee] = React.useState<AssigneeFilter>('all')
  const [data, setData] = React.useState<ProductFeedbackListResponse | null>(null)
  const [focused, setFocused] = React.useState<ProductFeedbackReportView | null>(null)
  const [focusMissing, setFocusMissing] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [claimingId, setClaimingId] = React.useState<string | null>(null)
  const requestId = React.useRef(0)

  const filters = React.useMemo<ListFeedbackFilters>(
    () => ({
      status: status === 'all' ? undefined : status,
      kind: kind === 'all' ? undefined : kind,
      assignee: assignee === 'all' ? undefined : assignee,
    }),
    [status, kind, assignee]
  )

  const load = React.useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(false)
    try {
      const next = await client.list(filters)
      if (id === requestId.current) setData(next)
    } catch {
      if (id === requestId.current) setError(true)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [client, filters])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (!focusReportId) return
    let cancelled = false
    setFocusMissing(false)
    client
      .get(focusReportId)
      .then((report) => {
        if (cancelled) return
        setFocused(report)
        setFocusMissing(report === null)
      })
      .catch(() => {
        if (!cancelled) setFocusMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [client, focusReportId])

  React.useEffect(() => {
    if (!claimTicketId || !canTriage || !client.claim) return
    let cancelled = false
    client
      .claim(claimTicketId)
      .then((report) => {
        if (cancelled) return
        setFocused(report)
        setFocusMissing(false)
        toast.success(
          report.ticket?.number
            ? t('platform.claimed', { number: report.ticket.number })
            : t('platform.claimedUnnumbered')
        )
      })
      .catch(() => {
        if (!cancelled) toast.error(t('platform.claimError'))
      })
    return () => {
      cancelled = true
    }
  }, [client, claimTicketId, canTriage, t])

  async function loadMore(): Promise<void> {
    if (!data?.nextCursor) return
    const id = requestId.current
    setLoadingMore(true)
    try {
      const next = await client.list({ ...filters, cursor: data.nextCursor })
      if (id !== requestId.current) return
      setData((current) =>
        current
          ? { ...next, reports: [...current.reports, ...next.reports], unticketed: current.unticketed }
          : next
      )
    } catch {
      toast.error(t('platform.loadError'))
    } finally {
      setLoadingMore(false)
    }
  }

  async function changeStatus(
    report: ProductFeedbackReportView,
    next: SupportTicketStatus
  ): Promise<void> {
    const previous = report.ticket?.status
    if (!previous || next === previous) return
    setBusyId(report.id)
    try {
      const updated = await client.triage(report.id, next)
      setFocused((current) => (current?.id === updated.id ? updated : current))
      setData((current) =>
        current
          ? {
              ...current,
              reports: current.reports.map((row) => (row.id === updated.id ? updated : row)),
              counts: current.counts && {
                ...current.counts,
                [previous]: Math.max(0, current.counts[previous] - 1),
                [next]: current.counts[next] + 1,
              },
            }
          : current
      )
      toast.success(t('platform.triaged', { status: t(`statuses.${next}`) }))
    } catch {
      toast.error(t('platform.triageError'))
    } finally {
      setBusyId(null)
    }
  }

  async function claimRow(report: ProductFeedbackReportView): Promise<void> {
    const ticketId = report.ticket?.id
    if (!ticketId || !client.claim) return
    setClaimingId(report.id)
    try {
      const updated = await client.claim(ticketId)
      setFocused((current) => (current?.id === updated.id ? updated : current))
      setData((current) =>
        current
          ? { ...current, reports: current.reports.map((row) => (row.id === updated.id ? updated : row)) }
          : current
      )
      toast.success(
        updated.ticket?.number
          ? t('platform.claimed', { number: updated.ticket.number })
          : t('platform.claimedUnnumbered')
      )
    } catch {
      toast.error(t('platform.claimError'))
    } finally {
      setClaimingId(null)
    }
  }

  const reports = (data?.reports ?? []).filter((report) => report.id !== focused?.id)
  const unticketed = (data?.unticketed ?? []).filter((report) => report.id !== focused?.id)
  const counts = data?.counts ?? null
  const total = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : undefined
  const active = counts
    ? ACTIVE_SUPPORT_TICKET_STATUSES.reduce((sum, option) => sum + counts[option], 0)
    : undefined
  const canClaim = canTriage && Boolean(client.claim)
  const local = data?.source === 'local'
  const live = data?.source === 'posthog'
  const nothingShown = !focused && reports.length === 0

  return (
    <SectionCard
      title={t('platform.listTitle')}
      loading={loading && !data}
      refreshing={loading && data !== null}
      error={error && !data}
      errorMessage={t('platform.loadError')}
      onRetry={() => void load()}
      testId="feedback-triage"
      action={
        <Select value={kind} onValueChange={(value) => setKind(value as KindFilter)}>
          <SelectTrigger size="sm" aria-label={t('platform.filters.kindLabel')} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('platform.filters.allKinds')}</SelectItem>
            {PRODUCT_FEEDBACK_KINDS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`kinds.${option}.label`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="flex flex-col gap-4">
        {local ? (
          <Alert variant="info" data-testid="feedback-local-source">
            <CloudOff aria-hidden />
            <AlertTitle className="line-clamp-none">{t('platform.localSource.title')}</AlertTitle>
            <AlertDescription>{t('platform.localSource.description')}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              role="group"
              aria-label={t('platform.filters.label')}
              className="flex flex-wrap gap-1.5"
            >
              <StatusFilterChip
                active={status === 'active'}
                onClick={() => setStatus('active')}
                count={active}
              >
                {t('platform.filters.active')}
              </StatusFilterChip>
              {SUPPORT_TICKET_STATUSES.map((option) => (
                <StatusFilterChip
                  key={option}
                  active={status === option}
                  onClick={() => setStatus(option)}
                  count={counts?.[option]}
                >
                  {t(`statuses.${option}`)}
                </StatusFilterChip>
              ))}
              <StatusFilterChip
                active={status === 'all'}
                onClick={() => setStatus('all')}
                count={total}
              >
                {t('platform.filters.all')}
              </StatusFilterChip>
            </div>
            <div
              role="group"
              aria-label={t('platform.filters.assigneeLabel')}
              className="flex flex-wrap gap-1.5"
            >
              {ASSIGNEE_FILTERS.map((option) => (
                <StatusFilterChip
                  key={option}
                  active={assignee === option}
                  onClick={() => setAssignee(option)}
                >
                  {t(`platform.filters.assignees.${option}`)}
                </StatusFilterChip>
              ))}
            </div>
          </div>
        )}

        {data?.viewerNotInPosthog ? (
          <Alert variant="info" data-testid="feedback-viewer-not-in-posthog">
            <UserRoundX aria-hidden />
            <AlertTitle className="line-clamp-none">{t('platform.viewerNotInPosthog.title')}</AlertTitle>
            <AlertDescription>{t('platform.viewerNotInPosthog.description')}</AlertDescription>
          </Alert>
        ) : null}

        {focusMissing ? (
          <Alert variant="warning" data-testid="feedback-focus-missing">
            <SearchX aria-hidden />
            <AlertTitle className="line-clamp-none">{t('platform.focusMissing.title')}</AlertTitle>
            <AlertDescription>{t('platform.focusMissing.description')}</AlertDescription>
          </Alert>
        ) : null}

        {/* A refetch that failed keeps the rows it had and says so here; only a
            first load with nothing to show becomes the card's error state. */}
        {error && data ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{t('platform.loadError')}</p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                {t('platform.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {/* The filters stay above an empty result: an empty "New" queue is
            the normal state, and the way out of it is the chip next to it. */}
        {nothingShown ? (
          <EmptyState
            variant="bare"
            icon={MessageSquarePlus}
            title={t('platform.empty.title')}
            description={t('platform.empty.description')}
          />
        ) : (
          <ul className="flex flex-col divide-y" aria-busy={loading || undefined}>
            {focused && (
              <ReportRow
                report={focused}
                focused
                canTriage={canTriage && live}
                busy={busyId === focused.id}
                onStatusChange={(next) => void changeStatus(focused, next)}
                canClaim={canClaim && live}
                claiming={claimingId === focused.id}
                onClaim={() => void claimRow(focused)}
              />
            )}
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                canTriage={canTriage && live}
                busy={busyId === report.id}
                onStatusChange={(next) => void changeStatus(report, next)}
                canClaim={canClaim && live}
                claiming={claimingId === report.id}
                onClaim={() => void claimRow(report)}
              />
            ))}
          </ul>
        )}

        {unticketed.length > 0 ? (
          <section
            aria-labelledby="feedback-unticketed-title"
            data-testid="feedback-unticketed"
            className="flex flex-col gap-1 border-t pt-4"
          >
            <SectionLabel as="h3" id="feedback-unticketed-title">
              {t('platform.unticketed.title')}
            </SectionLabel>
            <p className="text-muted-foreground text-xs">{t('platform.unticketed.description')}</p>
            <ul className="flex flex-col divide-y">
              {unticketed.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  canTriage={false}
                  busy={false}
                  onStatusChange={() => undefined}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {data?.nextCursor && (
          <Button
            variant="secondary"
            onClick={() => void loadMore()}
            loading={loadingMore}
            className="self-center"
          >
            {t('platform.loadMore')}
          </Button>
        )}
      </div>
    </SectionCard>
  )
}
