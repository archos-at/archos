'use client'

import {
  type FC,
  type KeyboardEvent,
  forwardRef,
  memo,
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import Link from 'next/link'
import {
  AlertCircle,
  FileCheck2,
  FlaskConical,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Square,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemList, ItemMedia } from '@/components/ui/item'
import { SearchField } from '@/components/ui/search-field'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageSheet } from '@/components/ui/page-sheet'
import { AnimatePresence, motion, motionQuick } from '@/components/motion'
import { cn } from '@/lib/utils'
import { formatAbsoluteTime, formatRelativeTime, formatTimeOfDay } from '@/lib/format'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'
import { listResearchRuns, type ResearchRun } from '@/adapters/api/research-runs-client'
import { useLayoutStore } from '../store'
import { useChatStore } from '@/features/chat/store'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'
import { SessionTemporaryMark, TEMPORARY_LABEL } from './session-temporary-mark'
import { DeleteAllSessionsConfirmationModal } from './DeleteAllSessionsConfirmationModal'
import { StopResearchConfirmationModal } from './StopResearchConfirmationModal'
import { cancelJob } from '@/adapters/api/deep-research-client'

interface Session {
  id: string
  title: string
  date: Date
  hasActiveDeepResearch?: boolean
  hasCompletedReport?: boolean
  contentLocked?: boolean
  temporary?: boolean
}

type HistoryScope = 'all' | 'chats' | 'research'

const HISTORY_SCOPES: readonly HistoryScope[] = ['all', 'chats', 'research']

const isHistoryScope = (value: string): value is HistoryScope =>
  (HISTORY_SCOPES as readonly string[]).includes(value)

const SCOPE_LABEL_KEY: Record<HistoryScope, string> = {
  all: 'sessionsPanel.filterAll',
  chats: 'sessionsPanel.filterChats',
  research: 'sessionsPanel.filterResearch',
}

interface SessionsPanelProps {
  sessions?: Session[]
  selectedSessionId?: string
  onSelectSession?: (sessionId: string) => void
  onNewSession?: () => void
  onDeleteSession?: (sessionId: string) => void
  onDeleteAllSessions?: () => void
  onRenameSession?: (sessionId: string, newTitle: string) => void
  projectId?: string
}

export const SessionsPanel: FC<SessionsPanelProps> = memo(function SessionsPanel({
  sessions = [],
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onDeleteAllSessions,
  onRenameSession,
  projectId,
}) {
  const t = useTranslations(researchCopy)
  const tCommon = useTranslations(commonCopy)
  const { locale } = useLocale()
  const isMobile = useIsMobile()
  const isSessionsPanelOpen = useLayoutStore((s) => s.isSessionsPanelOpen)
  const setSessionsPanelOpen = useLayoutStore((s) => s.setSessionsPanelOpen)

  const isSessionBusy = useChatStore((s) => s.isSessionBusy)
  const anySessionBusy = useChatStore((s) => s.hasAnyBusySession())
  const { isStreaming, hasPendingInteraction } = useChatStore(
    useShallow((s) => ({
      isStreaming: s.isStreaming,
      hasPendingInteraction: s.pendingInteraction !== null,
    }))
  )
  const isNavigationBlocked = isStreaming || hasPendingInteraction
  const [searchQuery, setSearchQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<HistoryScope>('all')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [pendingStop, setPendingStop] = useState<ResearchRun | null>(null)

  const [deepResearchRuns, setDeepResearchRuns] = useState<ResearchRun[] | null>(null)
  const [deepResearchError, setDeepResearchError] = useState(false)
  const deepResearchFetchInFlightRef = useRef(false)
  const deepResearchProjectRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isSessionsPanelOpen) {
      setSearchQuery('')
      setScopeFilter('all')
    }
  }, [isSessionsPanelOpen])

  const fetchDeepResearchRuns = useCallback(() => {
    if (!projectId) return
    if (deepResearchFetchInFlightRef.current) return
    deepResearchFetchInFlightRef.current = true
    const requestedProject = projectId
    deepResearchProjectRef.current = requestedProject
    setDeepResearchError(false)
    listResearchRuns({ projectId: requestedProject, limit: 50 })
      .then((response) => {
        if (deepResearchProjectRef.current !== requestedProject) return
        const sorted = [...response.jobs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        setDeepResearchRuns(sorted)
      })
      .catch(() => {
        if (deepResearchProjectRef.current === requestedProject) setDeepResearchError(true)
      })
      .finally(() => {
        deepResearchFetchInFlightRef.current = false
      })
  }, [projectId])

  useEffect(() => {
    if (!isSessionsPanelOpen || !projectId) return
    fetchDeepResearchRuns()
  }, [isSessionsPanelOpen, projectId, fetchDeepResearchRuns])

  const handleDeleteClick = useCallback((sessionId: string) => {
    setSessionToDelete(sessionId)
    setDeleteModalOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (sessionToDelete) {
      onDeleteSession?.(sessionToDelete)
      setSessionToDelete(null)
    }
  }, [sessionToDelete, onDeleteSession])

  const handleDeleteAllClick = useCallback(() => {
    setDeleteAllModalOpen(true)
  }, [])

  const handleConfirmDeleteAll = useCallback(() => {
    onDeleteAllSessions?.()
  }, [onDeleteAllSessions])

  const handleClose = useCallback(() => {
    setSessionsPanelOpen(false)
  }, [setSessionsPanelOpen])

  const handleNewSession = useCallback(() => {
    onNewSession?.()
    handleClose()
  }, [onNewSession, handleClose])

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      onSelectSession?.(sessionId)
      handleClose()
    },
    [onSelectSession, handleClose]
  )

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    searchInputRef.current?.focus()
  }, [])

  const handleConfirmStop = useCallback(async () => {
    if (!pendingStop) return
    try {
      await cancelJob(pendingStop.job_id, undefined, { projectId })
    } catch (err) {
      console.warn('[SessionsPanel] Failed to stop run:', pendingStop.job_id, err)
    }
    fetchDeepResearchRuns()
  }, [pendingStop, projectId, fetchDeepResearchRuns])

  const untitledLabel = t('sessionsPanel.untitledSession')
  const trimmedQuery = searchQuery.trim()
  const isSearching = trimmedQuery !== ''

  const filteredSessions = useMemo(() => {
    if (!trimmedQuery) return sessions
    const query = trimmedQuery.toLowerCase()
    return sessions.filter((s) => {
      const title = s.title.trim() || untitledLabel
      return title.toLowerCase().includes(query)
    })
  }, [sessions, trimmedQuery, untitledLabel])

  const todayLabel = t('sessionsPanel.today')
  const groupedSessions = useMemo(
    () =>
      groupSessionsByDate(
        filteredSessions,
        {
          today: todayLabel,
          yesterday: t('sessionsPanel.yesterday'),
        },
        locale
      ),
    [filteredSessions, t, todayLabel, locale]
  )
  const hasSessions = sessions.length > 0
  const isEmptyState = filteredSessions.length === 0

  const sessionTitleById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of sessions) {
      const title = s.title.trim()
      if (title) map[s.id] = title
    }
    return map
  }, [sessions])

  const runLabel = useCallback(
    (run: ResearchRun): string => {
      const title = run.conversation_id ? sessionTitleById[run.conversation_id] : undefined
      return title ?? t('runsList.untitledRun')
    },
    [sessionTitleById, t]
  )

  const runHref = useCallback(
    (run: ResearchRun): string | null =>
      run.conversation_id
        ? `/app/projects/${projectId}/chat?session=${encodeURIComponent(run.conversation_id)}`
        : null,
    [projectId]
  )

  const filteredRuns = useMemo(() => {
    const runs = deepResearchRuns ?? []
    if (!trimmedQuery) return runs
    const query = trimmedQuery.toLowerCase()
    return runs.filter((run) => runLabel(run).toLowerCase().includes(query))
  }, [deepResearchRuns, trimmedQuery, runLabel])

  const deepResearchEnabled = Boolean(projectId)
  const researchScopeSelected = deepResearchEnabled && scopeFilter === 'research'
  const showChats = !deepResearchEnabled || scopeFilter !== 'research'
  const isResearchLoading = deepResearchRuns === null && !deepResearchError

  const showResearchSection =
    deepResearchEnabled &&
    scopeFilter !== 'chats' &&
    (researchScopeSelected || isResearchLoading || deepResearchError || filteredRuns.length > 0)

  const handleStopRun = useCallback((run: ResearchRun) => {
    setPendingStop(run)
  }, [])

  return (
    <PageSheet
      open={isSessionsPanelOpen}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
      title={t('sessionsPanel.title')}
      subtitle={
        hasSessions
          ? sessions.length === 1
            ? t('sessionsPanel.countLabelOne')
            : t('sessionsPanel.countLabel', { count: sessions.length })
          : undefined
      }
      closeLabel={t('sessionsPanel.close')}
      initialFocusRef={isMobile ? undefined : searchInputRef}
      bodyClassName="flex min-h-0 flex-col"
    >
      {/* ---- Pinned block: the controls that must never scroll away ----
          The sheet's width is the place; the centred `max-w-3xl` column is the
          measure — the same geometry as the Inbox sheet, applied per band so
          the footer's border can still run edge to edge. */}
      <div className="shrink-0 px-4 pb-3 pt-4 md:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {/* New chat is disabled and every row is dimmed while a turn is in
              flight. Say why, ABOVE the controls it explains, rather than leaving
              the user to test them one by one. The spinner carries "temporary"
              without spending a word on it. */}
          {isNavigationBlocked && (
            <p
              className="border-border bg-muted text-muted-foreground flex min-h-11 items-start gap-2 rounded-surface border px-3 py-2 text-xs"
              role="status"
            >
              {/* Spinner injects its own role=status; hide it so this region
                  announces the message once rather than "Loading" + the copy. */}
              <span aria-hidden="true">
                <Spinner size="sm" className="mt-0.5 shrink-0" />
              </span>
              <span>{t('sessionsPanel.navigationBlocked')}</span>
            </p>
          )}

          <Button
            variant="secondary"
            className="h-9 w-full justify-start gap-2 pointer-coarse:h-11"
            onClick={handleNewSession}
            disabled={isNavigationBlocked}
            aria-label={
              isNavigationBlocked
                ? t('sessionsPanel.newSessionDisabled')
                : t('sessionsPanel.startNewSession')
            }
            title={
              isNavigationBlocked
                ? t('sessionsPanel.cannotCreateActive')
                : t('sessionsPanel.startNewSession')
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            <span className="text-sm font-medium">{t('sessionsPanel.newSessionButton')}</span>
          </Button>

          {/* No list, nothing to search — the field would be a control that can
              only ever return nothing. */}
          {hasSessions && (
            <div className="flex flex-col gap-1.5">
              {/* Same molecule as every other search in the product (`DataToolbar`,
                  file search). `type="text"` so specs still query a textbox;
                  `inputRef` receives the sheet's initial focus (desktop). */}
              <SearchField
                type="text"
                inputRef={searchInputRef}
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={handleClearSearch}
                placeholder={t('sessionsPanel.searchPlaceholder')}
                label={t('sessionsPanel.searchAria')}
                clearLabel={t('sessionsPanel.clearSearch')}
              />
              {/* Says how much of the list the query is hiding — announced, so a
                  screen-reader user learns it without scanning the list. */}
              {isSearching && (
                <p className="text-muted-foreground px-0.5 text-xs" aria-live="polite">
                  {t('sessionsPanel.searchResults', {
                    count: filteredSessions.length,
                    total: sessions.length,
                  })}
                </p>
              )}
            </div>
          )}

          {/* Scope filter (FB-10) — the inbox toolbar pattern. It composes with
              the search: the query still covers whichever list is showing. */}
          {deepResearchEnabled && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={scopeFilter}
              onValueChange={(value) => {
                if (isHistoryScope(value)) setScopeFilter(value)
              }}
              aria-label={t('sessionsPanel.filterAria')}
            >
              {HISTORY_SCOPES.map((scope) => (
                <ToggleGroupItem key={scope} value={scope}>
                  {t(SCOPE_LABEL_KEY[scope])}
                  {scope === 'research' && (
                    <CountPill
                      className={cn((deepResearchRuns?.length ?? 0) === 0 && 'invisible')}
                      aria-hidden={(deepResearchRuns?.length ?? 0) === 0 || undefined}
                      count={deepResearchRuns?.length ?? 0}
                    />
                  )}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
      </div>

      {/* ---- The one scrolling region ----
          `scroll-fade-bottom` dissolves the last row at the edge instead of
          guillotining it (design language, "Scroll boundaries"). No row
          stagger, deliberately: the user opened this to reach a specific row,
          and a cascade delays precisely the row they are reaching for — the
          sheet's own rise is the arrival. */}
      <div className="scroll-fade-bottom flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-6 md:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          {/* Deep Research (FB-10) — server-truth runs for this project, always
              open, with a count. Includes headless/CLI jobs that have no local
              session. Quiet under "All" when there is nothing to show; the
              whole list under the Deep Research scope. */}
          {showResearchSection && (
            <section data-testid="deep-research-section" className="mb-4 flex flex-col gap-1.5">
              <SectionLabel
                as="h3"
                icon={FlaskConical}
                className="flex items-center gap-1.5 pt-1"
              >
                {t('sessionsPanel.deepResearchHeading')}
                <CountPill
                  className={cn(filteredRuns.length === 0 && 'invisible')}
                  aria-hidden={filteredRuns.length === 0 || undefined}
                  count={filteredRuns.length}
                />
              </SectionLabel>

              {isResearchLoading ? (
                <ItemList
                  as="ul"
                  aria-busy="true"
                  data-testid="deep-research-skeleton"
                  className="border-border bg-card shadow-xs"
                >
                  {Array.from({ length: 2 }).map((_, index) => (
                    <Item as="li" key={index} className="items-start py-3.5">
                      <ItemMedia>
                        <Skeleton className="size-8 shrink-0 rounded-full" />
                      </ItemMedia>
                      <ItemContent className="flex flex-col gap-2">
                        <Skeleton className="h-3.5 w-3/5" />
                        <Skeleton className="h-4 w-24" />
                      </ItemContent>
                    </Item>
                  ))}
                </ItemList>
              ) : deepResearchError ? (
                <div className="bg-card flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-surface px-4 py-2.5 shadow-xs">
                  <p className="text-muted-foreground text-xs">
                    {t('sessionsPanel.researchLoadFailed')}
                  </p>
                  <Button variant="secondary" size="sm" onClick={fetchDeepResearchRuns}>
                    {tCommon('actions.retry')}
                  </Button>
                </div>
              ) : filteredRuns.length === 0 ? (
                isSearching ? (
                  <EmptyState
                    variant="bare"
                    icon={Search}
                    title={t('sessionsPanel.noMatching')}
                    description={t('sessionsPanel.noMatchingDescription', { query: trimmedQuery })}
                    action={
                      <Button variant="secondary" size="sm" onClick={handleClearSearch}>
                        {t('sessionsPanel.clearSearch')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    variant="bare"
                    icon={FlaskConical}
                    title={t('sessionsPanel.noRuns')}
                    description={t('sessionsPanel.noRunsDescription')}
                  />
                )
              ) : (
                <ItemList as="ul" className="border-0 bg-card shadow-xs">
                  {filteredRuns.map((run) => {
                    const status = run.status
                    const href = runHref(run)
                    return (
                    <Item key={run.job_id} as="li" className="relative items-start py-3.5">
                      {/* The media disc mirrors the inbox anatomy; a failed run
                          is the one tinted case, and its Badge below says the
                          same in words — colour never travels alone. */}
                      <ItemMedia
                        aria-hidden
                        className={cn(
                          'mt-0.5 rounded-full border',
                          status === 'failed'
                            ? 'border-transparent bg-destructive/10 text-destructive'
                            : 'border-border bg-card text-muted-foreground'
                        )}
                      >
                        <RunStatusIcon status={status} />
                      </ItemMedia>
                      <ItemContent>
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          {/* Stretched link: the whole row is the target. The
                              truncation lives on an inner span so the overlay
                              pseudo-element cannot be clipped by it.

                              A run with no thread to open keeps the same line
                              without the link and without the overlay: the row
                              still names the run and states its status, and it
                              no longer promises a click it cannot honour. */}
                          {href ? (
                            <Link
                              href={href}
                              onClick={handleClose}
                              aria-label={t('sessionsPanel.deepResearchRunLabel', {
                                label: runLabel(run),
                                status: t(runStatusKey(status)),
                              })}
                              className="min-w-0 flex-1 rounded-control text-sm font-medium leading-snug outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                            >
                              <span className="block truncate" title={runLabel(run)}>
                                {runLabel(run)}
                              </span>
                            </Link>
                          ) : (
                            <span
                              className="min-w-0 flex-1 truncate text-sm font-medium leading-snug"
                              title={runLabel(run)}
                            >
                              {runLabel(run)}
                            </span>
                          )}
                          <time
                            className="text-muted-foreground shrink-0 text-xs"
                            dateTime={run.created_at}
                            title={formatAbsoluteTime(run.created_at, locale)}
                          >
                            {formatRelativeTime(run.created_at, locale)}
                          </time>
                        </div>
                        {/* The state in WORDS, on its own line — a failed run
                            and a finished one used to differ only by icon. */}
                        <div className="mt-1.5 flex items-center gap-1">
                          <Badge variant={runBadgeVariant(status)}>
                            {t(runStatusKey(status))}
                          </Badge>
                          {/* A run that will never finish cannot be waited out:
                              stop it here. The stretched link covers the whole
                              row, so the button sits above it (`relative z-10`)
                              the way the chat rows' overlay actions do. */}
                          {isRunActive(status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="relative z-10 size-7 pointer-coarse:size-11"
                              onClick={() => handleStopRun(run)}
                              aria-label={t('sessionsPanel.stopResearch')}
                              title={t('sessionsPanel.stopResearchTitle')}
                            >
                              <Square className="size-4" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </ItemContent>
                    </Item>
                    )
                  })}
                </ItemList>
              )}
            </section>
          )}

          {showChats &&
            groupedSessions.map(([dateLabel, dateSessions]) => (
              <div key={dateLabel} className="mb-4 flex flex-col gap-1.5 last:mb-0">
                {/* Sticky so the day you are scrolling through stays named. The
                    scroller is the offset parent, hence `top-0`; `-mx-2 px-2`
                    widens the opaque backing past the card's shadow so rows pass
                    UNDER it rather than beside it. */}
                <SectionLabel className="bg-background sticky top-0 z-10 -mx-2 px-2 pb-1.5 pt-1">
                  {dateLabel}
                </SectionLabel>
                <ItemList as="ul" className="border-0 bg-card shadow-xs">
                  {/*Deleting a row removes it, so the list needs an exit —
                      which CSS cannot give it — and `layout` so the rows below
                      close the gap instead of jumping. The inbox's pattern,
                      for the same reason. */}
                  <AnimatePresence initial={false} mode="popLayout">
                    {dateSessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        isSelected={selectedSessionId === session.id}
                        isBusy={isNavigationBlocked}
                        isSessionActive={isSessionBusy(session.id)}
                        showRelativeTime={dateLabel === todayLabel}
                        onSelect={handleSessionClick}
                        onDelete={handleDeleteClick}
                        onRename={onRenameSession}
                      />
                    ))}
                  </AnimatePresence>
                </ItemList>
              </div>
            ))}

          {showChats && isEmptyState && (
            <div className="flex flex-1 flex-col items-center justify-center py-8">
              {isSearching ? (
                <EmptyState
                  variant="bare"
                  icon={Search}
                  title={t('sessionsPanel.noMatching')}
                  description={t('sessionsPanel.noMatchingDescription', { query: trimmedQuery })}
                  action={
                    <Button variant="secondary" size="sm" onClick={handleClearSearch}>
                      {t('sessionsPanel.clearSearch')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  variant="bare"
                  icon={MessageSquare}
                  title={t('sessionsPanel.noSessions')}
                  description={t('sessionsPanel.noSessionsDescription')}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Footer: what "saved" means, and the bulk destroyer at the far end ---- */}
      <div className="bg-background shrink-0 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <p className="text-muted-foreground text-xs">{t('sessionsPanel.syncedNote')}</p>
          {/* Delete-all lives HERE, not above the list. It used to sit in the
              top row with equal weight to New chat — the loudest thing in the
              panel was the one action that destroys everything in it, one row
              above the rows it deletes. */}
          {hasSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive -ml-2 h-8 w-fit justify-start px-2 pointer-coarse:h-11"
              onClick={handleDeleteAllClick}
              disabled={anySessionBusy}
              aria-label={
                anySessionBusy ? t('sessionsPanel.deleteAllDisabled') : t('sessionsPanel.deleteAll')
              }
              title={
                anySessionBusy ? t('sessionsPanel.cannotDeleteBusy') : t('sessionsPanel.deleteAll')
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span>{t('sessionsPanel.deleteAllButton')}</span>
            </Button>
          )}
        </div>
      </div>

      <DeleteSessionConfirmationModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirm={handleConfirmDelete}
        sessionTitle={sessions.find((s) => s.id === sessionToDelete)?.title}
      />

      <DeleteAllSessionsConfirmationModal
        open={deleteAllModalOpen}
        onOpenChange={setDeleteAllModalOpen}
        onConfirm={handleConfirmDeleteAll}
        count={sessions.length}
      />

      {/* Stopping cancels server-side work that cannot be resumed — it
          confirms through the shared ConfirmDialog rather than firing off
          its icon. */}
      <StopResearchConfirmationModal
        open={pendingStop !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStop(null)
        }}
        onConfirm={() => handleConfirmStop()}
      />
    </PageSheet>
  )
})

interface SessionItemProps {
  session: Session
  isSelected: boolean
  isBusy?: boolean
  isSessionActive?: boolean
  showRelativeTime?: boolean
  onSelect?: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onRename?: (sessionId: string, newTitle: string) => void
}

const SessionItem = forwardRef<HTMLLIElement, SessionItemProps>(function SessionItem(
  {
    session,
    isSelected,
    isBusy = false,
    isSessionActive = false,
    showRelativeTime = false,
    onSelect,
    onDelete,
    onRename,
  },
  ref
) {
  const t = useTranslations(researchCopy)
  const { locale } = useLocale()
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const tCollab = useTranslations(collaborationCopy)
  const displayTitle = session.contentLocked
    ? tCollab('rightsLost.neutralTitle')
    : session.title.trim() || t('sessionsPanel.untitledSession')

  const sessionDate = session.date instanceof Date ? session.date : new Date(session.date)
  const sessionIso = Number.isNaN(sessionDate.getTime()) ? '' : sessionDate.toISOString()
  const showResearchChip = session.hasActiveDeepResearch || session.hasCompletedReport

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleClick = useCallback(() => {
    if (!isEditing && !isBusy) {
      onSelect?.(session.id)
    }
  }, [isEditing, isBusy, onSelect, session.id])

  const startRename = useCallback(() => {
    setEditValue(session.title)
    setIsEditing(true)
  }, [session.title])

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      startRename()
    },
    [startRename]
  )

  const renameFromMenuRef = useRef(false)
  const handleMenuCloseAutoFocus = useCallback((e: Event) => {
    if (!renameFromMenuRef.current) return
    renameFromMenuRef.current = false
    e.preventDefault()
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete?.(session.id)
    },
    [onDelete, session.id]
  )

  const handleSaveRename = useCallback(() => {
    const trimmedValue = editValue.trim()
    if (!trimmedValue) {
      setEditValue(session.title)
      setIsEditing(false)
      return
    }
    if (trimmedValue !== session.title) {
      onRename?.(session.id, trimmedValue)
    }
    setIsEditing(false)
  }, [editValue, session.id, session.title, onRename])

  const handleCancelRename = useCallback(() => {
    setEditValue(session.title)
    setIsEditing(false)
  }, [session.title])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSaveRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelRename()
      }
    },
    [handleSaveRename, handleCancelRename]
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value)
  }, [])

  const showActions = (isHovered || isFocused) && !isEditing

  const statusKey = statusKeyFor(session, isSessionActive)
  const stateLabel = isBusy
    ? t('sessionsPanel.sessionLabelBusy', { title: displayTitle })
    : statusKey
      ? t('sessionsPanel.sessionLabelWithStatus', { title: displayTitle, status: t(statusKey) })
      : t('sessionsPanel.sessionLabel', { title: displayTitle })
  const rowLabel = session.temporary ? t(TEMPORARY_LABEL, { label: stateLabel }) : stateLabel

  return (
    <Item
      asChild
      className={cn(
        'relative min-h-11 gap-3',
        showResearchChip ? 'items-start' : 'items-center',
        isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        isSelected
          ? 'bg-selected ring-border ring-1 ring-inset hover:bg-selected'
          : 'hover:bg-hover focus-within:bg-hover'
      )}
    >
      <motion.li
        ref={ref}
        layout
        exit={{ opacity: 0, x: 12 }}
        transition={motionQuick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsFocused(false)
          }
        }}
      >
        {isEditing ? (
          <div className="flex min-h-8 w-full items-center">
            <Input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveRename}
              className="h-8 min-w-0 flex-1 px-2.5 pointer-coarse:h-11"
              aria-label={t('sessionsPanel.editTitle')}
            />
          </div>
        ) : (
          <>
            {/* Decorative — the button's label already carries this state in
                words (see `statusKeyFor`). Sibling of the button: a <div> may
                not live inside one, and the stretched overlay keeps the disc
                clickable anyway. */}
            <ItemMedia
              aria-hidden
              className={cn(
                'border-border bg-card rounded-full border',
                showResearchChip && 'mt-0.5'
              )}
            >
              <SessionStatusIcon session={session} isSessionActive={isSessionActive} />
            </ItemMedia>

            <button
              type="button"
              onClick={handleClick}
              disabled={isBusy}
              aria-current={isSelected ? 'true' : undefined}
              aria-label={rowLabel}
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-control text-left outline-none pointer-coarse:mr-9 after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              {/* Two-line content block: title + persistent time on line 1, the
                  calm Deep Research badge on line 2. */}
              <span className="flex min-w-0 items-center gap-2">
                {/* Two lines on a phone: a chat is found by its name, and "Rettungswege
                    Bürogeb…" names nothing. One truncated line on a pointer device. */}
                <span
                  className="min-w-0 flex-1 text-sm max-sm:line-clamp-2 max-sm:break-words sm:truncate"
                  title={displayTitle}
                >
                  {displayTitle}
                </span>
                {session.temporary && <SessionTemporaryMark />}
                {sessionIso && (
                  <span
                    className="text-muted-foreground shrink-0 text-xs tabular-nums"
                    title={formatAbsoluteTime(sessionIso, locale)}
                  >
                    {showRelativeTime
                      ? formatRelativeTime(sessionIso, locale)
                      : formatTimeOfDay(sessionIso, locale)}
                  </span>
                )}
              </span>

              {/* FB-10: a calm "Deep Research" badge marks sessions that carry a
                  research run. It lives on its own line so it never swaps with
                  the trailing actions. */}
              {showResearchChip && (
                <Badge variant="secondary" className="mt-0.5">
                  {t('sessionsPanel.deepResearchChip')}
                </Badge>
              )}
            </button>
          </>
        )}

        {/* Touch has no hover, so rename and delete get a second way in: one
            visible 44px menu at the row's trailing edge, present only on a
            coarse pointer (the hover overlay below is the pointer's way). The
            row's title keeps its full width minus that one door. */}
        {!isEditing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute inset-y-0 right-0 z-10 my-auto hidden size-11 pointer-coarse:inline-flex"
                aria-label={t('sessionsPanel.rowActions', { title: displayTitle })}
                data-testid="session-row-menu"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            {/* To the left of the door, over the row it belongs to: dropped below it, the
                menu covered the next row's timestamp. */}
            <DropdownMenuContent
              side="left"
              align="center"
              onCloseAutoFocus={handleMenuCloseAutoFocus}
            >
              {!session.contentLocked && (
                <DropdownMenuItem
                  disabled={isBusy || isSessionActive}
                  onSelect={() => {
                    renameFromMenuRef.current = true
                    startRename()
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  {isBusy || isSessionActive
                    ? t('sessionsPanel.cannotRenameBusy')
                    : t('sessionsPanel.rename')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                disabled={isBusy || isSessionActive}
                onSelect={() => onDelete?.(session.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {isBusy || isSessionActive
                  ? t('sessionsPanel.cannotDeleteBusy')
                  : t('sessionsPanel.deleteSession')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* The actions OVERLAY the row on hover/focus instead of holding a
            permanent column that taxes every title's width. Overlaying is
            reflow-free (the row never resizes) and the resting row spends its
            full width on the title. The action block is a solid fill in the
            colour of the surface the row is actually on, so a long title
            slides under it instead of colliding: the selected grey on the
            selected row, else the sheet with the pointer's wash over it (two
            layers: the wash alone lets the title through). No gradient. */}
        {showActions && (
          <div className={cn('absolute inset-y-0 right-2 z-10 pointer-coarse:hidden animate-in fade-in-0 duration-snap ease-out motion-reduce:animate-none', isSelected ? 'bg-selected' : 'bg-card')}>
            <div className={cn('flex h-full items-center gap-1 pl-6', !isSelected && 'bg-hover')}>
              {!session.contentLocked && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={handleEditClick}
                  disabled={isBusy || isSessionActive}
                  aria-label={
                    isBusy || isSessionActive
                      ? t('sessionsPanel.renameDisabled')
                      : t('sessionsPanel.rename')
                  }
                  title={
                    isBusy || isSessionActive
                      ? t('sessionsPanel.cannotRenameBusy')
                      : t('sessionsPanel.rename')
                  }
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive size-7"
                onClick={handleDeleteClick}
                disabled={isBusy || isSessionActive}
                aria-label={
                  isBusy || isSessionActive
                    ? t('sessionsPanel.deleteDisabled')
                    : t('sessionsPanel.deleteSession')
                }
                title={
                  isBusy || isSessionActive
                    ? t('sessionsPanel.cannotDeleteBusy')
                    : t('sessionsPanel.deleteSession')
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </motion.li>
    </Item>
  )
})

const isRunActive = (status: string): boolean =>
  status !== 'completed' && status !== 'failed' && status !== 'cancelled'

const runStatusKey = (status: string): string => {
  if (status === 'completed') return 'sessionsPanel.runStatus.completed'
  if (status === 'failed') return 'sessionsPanel.runStatus.failed'
  if (status === 'cancelled') return 'sessionsPanel.runStatus.cancelled'
  return 'sessionsPanel.runStatus.running'
}

const runBadgeVariant = (status: string): 'success' | 'info' | 'destructive' | 'secondary' => {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'destructive'
  if (status === 'cancelled') return 'secondary'
  return 'info'
}

const RunStatusIcon: FC<{ status: string }> = ({ status }) => {
  if (status === 'completed') {
    return <FileCheck2 className="size-4 shrink-0" aria-hidden="true" />
  }
  if (status === 'failed' || status === 'cancelled') {
    return <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
  }
  return <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
}

const SessionStatusIcon: FC<{
  session: Session
  isSessionActive: boolean
}> = ({ session, isSessionActive }) => {
  const base = 'size-4 shrink-0'
  const isActive = isSessionActive || session.hasActiveDeepResearch

  if (isActive) {
    return <Loader2 className={cn(base, 'text-accent-primary animate-spin motion-reduce:animate-none')} aria-hidden="true" />
  }

  if (session.hasCompletedReport) {
    return <FileCheck2 className={cn(base, 'text-success')} aria-hidden="true" />
  }

  return <MessageSquare className={cn(base, 'text-muted-foreground')} aria-hidden="true" />
}

const statusKeyFor = (session: Session, isSessionActive: boolean): string | null => {
  if (isSessionActive || session.hasActiveDeepResearch) return 'sessionsPanel.sessionActive'
  if (session.hasCompletedReport) return 'sessionsPanel.reportCompleted'
  return null
}

const groupSessionsByDate = (
  sessions: Session[],
  labels: { today: string; yesterday: string },
  locale: string
): Array<[string, Session[]]> => {
  const groups = new Map<string, { sessions: Session[]; sortKey: number }>()
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  for (const session of sessions) {
    const sessionDate = new Date(session.date)
    let label: string

    if (isSameDay(sessionDate, today)) {
      label = labels.today
    } else if (isSameDay(sessionDate, yesterday)) {
      label = labels.yesterday
    } else {
      label = sessionDate.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }

    const time = sessionDate.getTime()
    const existing = groups.get(label)
    if (existing) {
      existing.sessions.push(session)
      existing.sortKey = Math.max(existing.sortKey, time)
    } else {
      groups.set(label, { sessions: [session], sortKey: time })
    }
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[1].sortKey - a[1].sortKey)
    .map(([label, group]) => [label, group.sessions] as [string, Session[]])
}

const isSameDay = (d1: Date, d2: Date): boolean => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}
