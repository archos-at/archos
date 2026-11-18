'use client'

import {
  type FC,
  memo,
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { MessageSquare, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { ItemList } from '@/components/ui/item'
import { SearchField } from '@/components/ui/search-field'
import { SectionLabel } from '@/components/ui/section-label'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageSheet } from '@/components/ui/page-sheet'
import { AnimatePresence } from '@/components/motion'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useLocale, useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'
import type { ResearchRun } from '@/adapters/api/research-runs-client'
import { useLayoutStore } from '../store'
import { useChatStore } from '@/features/chat/store'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'
import { DeleteAllSessionsConfirmationModal } from './DeleteAllSessionsConfirmationModal'
import { StopResearchConfirmationModal } from './StopResearchConfirmationModal'
import { cancelJob } from '@/adapters/api/deep-research-client'
import { useDeepResearchRuns } from '../hooks/use-deep-research-runs'
import { groupSessionsByDate } from '../lib/group-sessions-by-date'
import { HISTORY_SCOPES, SCOPE_LABEL_KEY, isHistoryScope, type HistoryScope } from '../lib/history-scope'
import type { Session } from '../types'
import { DeepResearchSection } from './sessions-panel/deep-research-section'
import { SessionItem } from './sessions-panel/session-item'

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

  useEffect(() => {
    if (!isSessionsPanelOpen) {
      setSearchQuery('')
      setScopeFilter('all')
    }
  }, [isSessionsPanelOpen])

  const { deepResearchRuns, deepResearchError, fetchDeepResearchRuns } = useDeepResearchRuns({
    isSessionsPanelOpen,
    projectId,
  })

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
            <DeepResearchSection
              filteredRuns={filteredRuns}
              isResearchLoading={isResearchLoading}
              deepResearchError={deepResearchError}
              isSearching={isSearching}
              trimmedQuery={trimmedQuery}
              runLabel={runLabel}
              runHref={runHref}
              handleClearSearch={handleClearSearch}
              fetchDeepResearchRuns={fetchDeepResearchRuns}
              handleClose={handleClose}
              handleStopRun={handleStopRun}
            />
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
