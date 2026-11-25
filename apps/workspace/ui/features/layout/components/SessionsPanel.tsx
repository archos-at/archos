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
import { FlaskConical, MessageSquare, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { ItemList } from '@/components/ui/item'
import { useRailChats } from '@/components/shell/rail-chats'
import { PHONE_RECENT_CHATS, RecentChatsSection } from './sessions-panel/recent-chats-section'
import { SearchField } from '@/components/ui/search-field'
import { SectionLabel } from '@/components/ui/section-label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageSheet } from '@/components/ui/page-sheet'
import { AnimatePresence } from '@/components/motion'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useLocale, useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'
import { useLayoutStore } from '../store'
import { useChatStore } from '@/features/chat/store'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'
import { DeleteAllSessionsConfirmationModal } from './DeleteAllSessionsConfirmationModal'
import { useDeepResearchRuns } from '../hooks/use-deep-research-runs'
import { groupSessionsByDate } from '../lib/group-sessions-by-date'
import { hasResearchMark, withRunMarks } from '../lib/run-marks'
import { HISTORY_SCOPES, SCOPE_LABEL_KEY, isHistoryScope, type HistoryScope } from '../lib/history-scope'
import type { Session } from '../types'
import { SessionItem } from './sessions-panel/session-item'

interface SessionsPanelProps {
  sessions?: Session[]
  selectedSessionId?: string
  onSelectSession?: (sessionId: string) => void
  onNewSession?: () => void
  onDeleteSession?: (sessionId: string) => void | Promise<void>
  onDeleteAllSessions?: () => void | Promise<void>
  onRenameSession?: (sessionId: string, newTitle: string) => void
  projectId?: string
  side?: 'personal' | 'project'
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
  side = projectId ? 'project' : 'personal',
}) {
  const t = useTranslations(researchCopy)
  const { locale } = useLocale()
  const isMobile = useIsMobile()
  const isSessionsPanelOpen = useLayoutStore((s) => s.isSessionsPanelOpen)
  const setSessionsPanelOpen = useLayoutStore((s) => s.setSessionsPanelOpen)

  const anySessionBusy = useChatStore((s) => s.hasAnyBusySession())
  const [searchQuery, setSearchQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<HistoryScope>('all')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isSessionsPanelOpen) {
      setSearchQuery('')
      setScopeFilter('all')
    }
  }, [isSessionsPanelOpen])

  const { deepResearch } = useDeepResearchRuns({
    isSessionsPanelOpen,
    projectId,
  })

  const handleDeleteClick = useCallback((sessionId: string) => {
    setSessionToDelete(sessionId)
    setDeleteModalOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!sessionToDelete) return
    await onDeleteSession?.(sessionToDelete)
    setSessionToDelete(null)
  }, [sessionToDelete, onDeleteSession])

  const handleDeleteAllClick = useCallback(() => {
    setDeleteAllModalOpen(true)
  }, [])

  const handleConfirmDeleteAll = useCallback(async () => {
    await onDeleteAllSessions?.()
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

  const untitledLabel = t('sessionsPanel.untitledSession')
  const trimmedQuery = searchQuery.trim()
  const isSearching = trimmedQuery !== ''

  const railChats = useRailChats()
  const recentChats = useMemo(
    () => (isMobile && !isSearching && scopeFilter === 'all' ? (railChats?.items ?? []).slice(0, PHONE_RECENT_CHATS) : []),
    [isMobile, isSearching, scopeFilter, railChats]
  )
  const openRecent = useCallback(
    (id: string) => {
      railChats?.onOpen?.(id)
      handleClose()
    },
    [railChats, handleClose]
  )

  const markedSessions = useMemo(
    () => withRunMarks(sessions, deepResearch.kind === 'loaded' ? deepResearch.runs : []),
    [sessions, deepResearch]
  )
  const researchCount = useMemo(() => markedSessions.filter(hasResearchMark).length, [markedSessions])

  const deepResearchEnabled = Boolean(projectId) && deepResearch.kind !== 'unavailable'
  const scope: HistoryScope = deepResearchEnabled ? scopeFilter : 'all'

  const filteredSessions = useMemo(() => {
    const query = trimmedQuery.toLowerCase()
    const shownAbove = new Set(recentChats.map((chat) => chat.id))
    return markedSessions.filter((s) => {
      if (shownAbove.has(s.id)) return false
      if (scope === 'research' && !hasResearchMark(s)) return false
      if (scope === 'chats' && hasResearchMark(s)) return false
      if (!query) return true
      const title = s.title.trim() || untitledLabel
      return title.toLowerCase().includes(query)
    })
  }, [markedSessions, scope, trimmedQuery, untitledLabel, recentChats])

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
  const deleteAllLabel =
    side === 'personal' ? t('sessionsPanel.deleteAllPersonal') : t('sessionsPanel.deleteAllProject')
  const isEmptyState = filteredSessions.length === 0 && recentChats.length === 0

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
          <Button
            variant="secondary"
            className="h-9 w-full justify-start gap-2 pointer-coarse:h-11"
            onClick={handleNewSession}
            aria-label={t('sessionsPanel.startNewSession')}
            title={t('sessionsPanel.startNewSession')}
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
                      className={cn(researchCount === 0 && 'invisible')}
                      aria-hidden={researchCount === 0 || undefined}
                      count={researchCount}
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
      <div className="scroll-fade-bottom flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain scroll-pt-8 px-4 pb-6 md:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          <RecentChatsSection chats={recentChats} onOpen={openRecent} />
          {groupedSessions.map(([dateLabel, dateSessions]) => (
              <div key={dateLabel} className="mb-4 flex flex-col gap-1.5 last:mb-0">
                {/* Sticky so the day you are scrolling through stays named. The
                    scroller is the offset parent, hence `top-0`; `-mx-2 px-2`
                    widens the opaque backing past the card's shadow so rows pass
                    UNDER it rather than beside it. */}
                <div className="sticky-head sticky top-0 z-10 -mx-2">
                  <SectionLabel className="fade-under-when-stuck bg-background block px-2 pb-1.5 pt-1">
                    {dateLabel}
                  </SectionLabel>
                </div>
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

          {isEmptyState && (
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
              ) : scope === 'research' ? (
                <EmptyState
                  variant="bare"
                  icon={FlaskConical}
                  title={t('sessionsPanel.noRuns')}
                  description={t('sessionsPanel.noRunsDescription')}
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
              aria-label={deleteAllLabel}
              title={anySessionBusy ? t('sessionsPanel.cannotDeleteBusy') : deleteAllLabel}
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
        side={side}
      />
    </PageSheet>
  )
})
