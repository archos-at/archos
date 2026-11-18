'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, Clock, SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemList,
  ItemTitle,
} from '@/components/ui/item'
import { SearchField } from '@/components/ui/search-field'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { qualityScopeQuery, readQualityScope, type QualityScope } from '@/lib/quality/scope'
import { cn } from '@/lib/utils'
import { CopyableId, shortId } from './copyable-id'
import { useQualityScopeLabel } from './quality-scope-label'
import { formatSpanDuration } from './agent-profiler-format'
import { ErrorAlert, ListSkeleton, TimelineSkeleton } from './agent-profiler-states'
import type {
  ConversationListDto,
  ConversationSummaryDto,
  TimelineDto,
} from './agent-profiler-types'
import { KindLegend, TurnWaterfall } from './agent-profiler-waterfall'

export { barGeometry } from './agent-profiler-waterfall'
export { formatSpanDuration }

const SEARCH_DEBOUNCE_MS = 300

export function AgentProfiler({
  scope,
  initialConversationId,
}: {
  scope: QualityScope
  initialConversationId?: string
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const scopeLabel = useQualityScopeLabel()
  const searchParams = useSearchParams()
  const preselected = initialConversationId ?? searchParams?.get('conversation') ?? null
  const scopeQuery = qualityScopeQuery(scope)

  const [conversations, setConversations] = useState<ConversationSummaryDto[] | null>(null)
  const [capped, setCapped] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [shownQuery, setShownQuery] = useState('')
  const [shownScopeQuery, setShownScopeQuery] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(preselected)
  const [selectedSummary, setSelectedSummary] = useState<ConversationSummaryDto | null>(null)
  const [droppedByScope, setDroppedByScope] = useState(false)
  const [timeline, setTimeline] = useState<TimelineDto | null>(null)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState(false)

  const listRequest = useRef<AbortController | null>(null)
  const timelineRequest = useRef<AbortController | null>(null)
  const timelineCardRef = useRef<HTMLDivElement | null>(null)
  const selectedRef = useRef(selectedId)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  const landedScope = useRef<string | null>(null)

  const load = useCallback((query: string, requestedScope: string) => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    setLoading(true)
    setError(false)
    const asked = selectedRef.current
    const params = new URLSearchParams(requestedScope)
    if (query) params.set('q', query)
    if (asked) params.set('conversation', asked)
    fetch(`/api/platform/profiler/conversations?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as ConversationListDto
        if (controller.signal.aborted) return
        const scopeChanged = landedScope.current !== null && landedScope.current !== requestedScope
        landedScope.current = requestedScope
        setConversations(data.conversations)
        setCapped(data.capped)
        setShownQuery(query)
        setShownScopeQuery(requestedScope)
        if (asked === null || asked !== selectedRef.current) return
        setSelectedSummary(data.selected ?? null)
        if (scopeChanged && data.selected === null) {
          setSelectedId(null)
          setDroppedByScope(true)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
      .finally(() => {
        if (listRequest.current === controller) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const query = search.trim()
    const handle = setTimeout(() => load(query, scopeQuery), query ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(handle)
  }, [search, scopeQuery, load])

  useEffect(() => () => listRequest.current?.abort(), [])

  const loadTimeline = useCallback((conversationId: string) => {
    timelineRequest.current?.abort()
    const controller = new AbortController()
    timelineRequest.current = controller
    setTimeline(null)
    setTimelineLoading(true)
    setTimelineError(false)
    fetch(`/api/platform/profiler/conversations/${encodeURIComponent(conversationId)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as TimelineDto
        if (!controller.signal.aborted) setTimeline(data)
      })
      .catch(() => {
        if (!controller.signal.aborted) setTimelineError(true)
      })
      .finally(() => {
        if (timelineRequest.current === controller) setTimelineLoading(false)
      })
  }, [])

  useEffect(() => {
    if (selectedId) loadTimeline(selectedId)
    return () => timelineRequest.current?.abort()
  }, [selectedId, loadTimeline])

  const selectConversation = (conversationId: string): void => {
    if (conversationId === selectedId) return
    setSelectedId(conversationId)
    setDroppedByScope(false)
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)').matches) {
      timelineCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const selected = useMemo(
    () =>
      conversations?.find((conversation) => conversation.conversationId === selectedId) ??
      (selectedSummary?.conversationId === selectedId ? selectedSummary : null),
    [conversations, selectedId, selectedSummary]
  )
  const shownScope = shownScopeQuery
    ? readQualityScope(new URLSearchParams(shownScopeQuery))
    : scope

  const organizationLabel = (conversation: ConversationSummaryDto): string =>
    conversation.organizationName ?? conversation.organizationId ?? t('profiler.noOrganization')

  const summaryLine = (conversation: ConversationSummaryDto): string =>
    [
      organizationLabel(conversation),
      t('profiler.turnCount', { count: conversation.turnCount }),
      t('profiler.totalTime', {
        duration: formatSpanDuration(conversation.totalDurationMs, locale),
      }),
    ].join(' · ')

  const listBody = (): JSX.Element => {
    if (conversations === null) {
      return error ? (
        <ErrorAlert
          title={t('profiler.loadError')}
          onRetry={() => load(search.trim(), scopeQuery)}
          busy={loading}
        />
      ) : (
        <ListSkeleton />
      )
    }
    return (
      <>
        {error ? (
          <ErrorAlert
            title={t('profiler.loadError')}
            onRetry={() => load(search.trim(), scopeQuery)}
            busy={loading}
          />
        ) : null}
        {conversations.length === 0 ? (
          shownQuery ? (
            <EmptyState
              variant="bare"
              icon={SearchX}
              title={t('profiler.noMatch', { query: shownQuery })}
            />
          ) : (
            <EmptyState variant="bare" icon={Clock} title={t('profiler.empty')} />
          )
        ) : (
          <div
            className={cn(
              'scroll-fade-bottom duration-base max-h-80 overflow-y-auto rounded-lg transition-opacity motion-reduce:transition-none lg:max-h-[32rem]',
              loading && 'opacity-60'
            )}
          >
            <ItemList as="ul">
              {conversations.map((conversation) => {
                const active = conversation.conversationId === selectedId
                return (
                  <li key={conversation.conversationId}>
                    <Item asChild className={cn('w-full', active && 'bg-selected hover:bg-selected')}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => selectConversation(conversation.conversationId)}
                      >
                        <ItemContent>
                          <ItemTitle>
                            {conversation.title || shortId(conversation.conversationId)}
                          </ItemTitle>
                          {conversation.titleWithheld ? (
                            <ItemDescription>{t('profiler.titleWithheld')}</ItemDescription>
                          ) : null}
                          <ItemDescription className="tabular-nums">
                            {summaryLine(conversation)}
                          </ItemDescription>
                          {/* A phone has no width for a time column beside the title. */}
                          <ItemDescription className="tabular-nums sm:hidden">
                            {formatRelativeTime(conversation.lastActiveAt, locale)}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions className="text-muted-foreground hidden self-start pt-0.5 text-xs tabular-nums sm:flex">
                          <time
                            dateTime={conversation.lastActiveAt}
                            title={formatAbsoluteTime(conversation.lastActiveAt, locale)}
                          >
                            {formatRelativeTime(conversation.lastActiveAt, locale)}
                          </time>
                        </ItemActions>
                      </button>
                    </Item>
                  </li>
                )
              })}
            </ItemList>
          </div>
        )}
        {capped && conversations.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('profiler.capped', { count: conversations.length })}
          </p>
        ) : null}
      </>
    )
  }

  const timelineBody = (): JSX.Element => {
    if (!selectedId)
      return (
        <EmptyState
          variant="bare"
          icon={Clock}
          title={t(droppedByScope ? 'profiler.outOfScope' : 'profiler.detailEmpty')}
        />
      )
    if (timelineError) {
      return (
        <ErrorAlert
          title={t('profiler.detailLoadError')}
          onRetry={() => loadTimeline(selectedId)}
          busy={timelineLoading}
        />
      )
    }
    if (timelineLoading || !timeline) return <TimelineSkeleton />
    if (timeline.turns.length === 0)
      return <EmptyState variant="bare" icon={Clock} title={t('profiler.noSpans')} />
    const totalTurns = Math.max(timeline.totalTurns ?? 0, timeline.turns.length)
    const firstTurnNumber = totalTurns - timeline.turns.length + 1
    return (
      <div className="usage-viz animate-in fade-in-0 duration-base flex flex-col gap-5 ease-out motion-reduce:animate-none">
        <KindLegend />
        {timeline.capped || totalTurns > timeline.turns.length ? (
          <p className="text-muted-foreground -mt-2 text-xs">
            {t('profiler.turnsCapped', { shown: timeline.turns.length, total: totalTurns })}
          </p>
        ) : null}
        <ol className="flex flex-col">
          {timeline.turns.map((turn, index) => (
            <li
              key={turn.turnId}
              className="flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t('profiler.turn')} {firstTurnNumber + index}
                  {turn.status === 'error' ? (
                    <Badge variant="outline" className="border-danger bg-danger-subtle text-error">
                      <AlertTriangle aria-hidden />
                      {t('profiler.turnFailed')}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
                  {formatSpanDuration(turn.durationMs, locale)} ·{' '}
                  {t('profiler.spanCount', { count: turn.spanCount })}
                  {turn.jobId ? (
                    <CopyableId
                      id={turn.jobId}
                      copyLabel={t('profiler.copyId', { id: turn.jobId })}
                      copiedLabel={t('profiler.copied')}
                      failedLabel={t('profiler.copyFailed')}
                    />
                  ) : null}
                </span>
              </div>
              <TurnWaterfall turn={turn} locale={locale} />
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div
      data-testid="agent-profiler"
      className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('profiler.listTitle')}</CardTitle>
          <CardDescription>
            {t('profiler.listDescription', { scope: scopeLabel(shownScope) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('profiler.search')}
            label={t('profiler.search')}
            type="text"
          />
          {listBody()}
        </CardContent>
      </Card>

      <Card ref={timelineCardRef} className="scroll-mt-4" data-testid="agent-profiler-timeline">
        <CardHeader>
          <CardTitle className="truncate leading-normal">
            {selected?.title || (selectedId ? shortId(selectedId) : t('profiler.timelineTitle'))}
          </CardTitle>
          <CardDescription className="tabular-nums">
            {selected ? summaryLine(selected) : t('profiler.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>{timelineBody()}</CardContent>
      </Card>
    </div>
  )
}
