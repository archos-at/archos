'use client'

import type { FocusEvent, JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { AlertCircle, Archive, Bell, CheckCheck, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { useInboxBadge, useInboxList } from '../hooks/use-inbox'
import { ARCHIVE_UNDO_MS, useUndoableArchive } from '../hooks/use-undoable-archive'
import type { InboxItemView, InboxListFilter } from '@/lib/inbox/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { Item, ItemContent, ItemList, ItemMedia } from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import { LoadMore } from '@/components/ui/load-more'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AnimatePresence, motion, motionQuick, motionQuickExit, useMotionToken } from '@/components/motion'
import { cn } from '@/lib/utils'
import { NotificationPrompt } from '@/features/notifications/components/notification-prompt'
import { focusLost, restoreFocus } from '@/features/documents/components/review/focus-return'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { SectionLabel } from '@/components/ui/section-label'
import { inboxSections, type InboxSection } from '../lib/inbox-day-groups'
import { InboxItemRow } from './InboxItemRow'
import { InboxQueue } from './InboxQueue'

type InboxFilter = 'needsMe' | 'all' | 'archived'

const FILTERS: readonly InboxFilter[] = ['needsMe', 'all', 'archived']

const API_FILTER: Record<InboxFilter, InboxListFilter> = {
  needsMe: 'pending',
  all: 'all',
  archived: 'archived',
}

const EMPTY_ICON = { needsMe: CheckCircle2, all: Bell, archived: Archive } as const

function isInboxFilter(value: string): value is InboxFilter {
  return (FILTERS as readonly string[]).includes(value)
}

const FILTER_PARAM = 'filter'

function filterOf(params: Pick<URLSearchParams, 'get'> | null, fallback: InboxFilter): InboxFilter {
  const named = params?.get(FILTER_PARAM)
  return named && isInboxFilter(named) ? named : fallback
}

function hrefOf(pathname: string, current: string, filter: InboxFilter): string {
  const params = new URLSearchParams(current)
  if (filter === 'needsMe') params.delete(FILTER_PARAM)
  else params.set(FILTER_PARAM, filter)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function keyedSections<T>(sections: InboxSection<T>[]): { key: string; section: InboxSection<T> }[] {
  const seen = new Map<string, number>()
  return sections.map((section) => {
    const nth = seen.get(section.group) ?? 0
    seen.set(section.group, nth + 1)
    return { key: nth === 0 ? section.group : `${section.group}-${nth}`, section }
  })
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('input, textarea, select, [role="textbox"], [role="menu"], [role="listbox"]')) return true
  return false
}

export interface InboxListProps {
  enabled?: boolean
  initialFilter?: InboxFilter
  viewerId?: string | null
  className?: string
}

export function InboxList({
  enabled = true,
  initialFilter = 'needsMe',
  viewerId = null,
  className,
}: InboxListProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState<InboxFilter>(() => filterOf(searchParams, initialFilter))
  const choose = (next: InboxFilter): void => {
    setFilter(next)
    setFocusedId(null)
    if (pathname) window.history.replaceState(null, '', hrefOf(pathname, searchParams?.toString() ?? '', next))
  }

  const {
    items,
    pending,
    loading,
    error,
    mutationError,
    dismissMutationError,
    mutating,
    refresh,
    hasMore,
    loadingMore,
    loadMoreFailed,
    loadMore,
    markRead,
    markUnread,
    markAllRead,
    archive,
    unarchive,
  } = useInboxList(enabled && filter !== 'needsMe', API_FILTER[filter])
  const queued = filter === 'needsMe'
  const badge = useInboxBadge(enabled && queued)
  const shownPending = queued ? badge.pending : pending

  const archiveLater = useUndoableArchive(archive)
  const visibleItems = items.filter((item) => !archiveLater.pendingIds.has(item.id))
  const hasUnread = visibleItems.some((item) => !item.read)

  const onArchive = useCallback(
    (itemId: string): void => {
      archiveLater.request(itemId)
      toast(t('inbox.archived'), {
        duration: ARCHIVE_UNDO_MS,
        action: { label: t('inbox.undo'), onClick: () => archiveLater.undo(itemId) },
      })
    },
    [archiveLater, t],
  )

  const onUnarchive = useCallback(
    (itemId: string): void => {
      void unarchive(itemId).then((restored) => {
        if (restored) toast(t('inbox.unarchived'))
      })
    },
    [unarchive, t],
  )

  const onOpen = useCallback(
    (item: InboxItemView) => {
      if (!item.read) void markRead([item.id])
    },
    [markRead],
  )

  const rootRef = useRef<HTMLDivElement>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedIndex = visibleItems.findIndex((item) => item.id === focusedId)

  const focusRow = useCallback((itemId: string, { scroll = true }: { scroll?: boolean } = {}) => {
    setFocusedId(itemId)
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`)
    row?.focus({ preventScroll: true })
    if (scroll) row?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  const listRef = useRef<HTMLDivElement>(null)
  const heldRowId = useRef<string | null>(null)
  const shownIds = useRef<string[]>([])
  useEffect(() => {
    const previous = shownIds.current
    shownIds.current = visibleItems.map((item) => item.id)
    const held = heldRowId.current
    if (!held || shownIds.current.includes(held)) return
    heldRowId.current = null
    const active = document.activeElement
    const inLeavingRow = active instanceof Element && active.closest('[data-item-id]')?.getAttribute('data-item-id') === held
    if (!inLeavingRow && !focusLost()) return
    const next = visibleItems[Math.min(Math.max(previous.indexOf(held), 0), visibleItems.length - 1)]
    if (next) focusRow(next.id, { scroll: false })
    else restoreFocus(listRef.current)
  }, [visibleItems, focusRow])
  const trackFocus = (event: FocusEvent<HTMLDivElement>): void => {
    heldRowId.current = event.target.closest('[data-item-id]')?.getAttribute('data-item-id') ?? null
  }
  const dropFocus = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) heldRowId.current = null
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (typingInto(event.target)) return
      const scope = root.closest('[role="dialog"]') ?? document.body
      if (event.target instanceof Node && event.target !== document.body && !scope.contains(event.target)) return
      const key = event.key
      if (key !== 'j' && key !== 'k' && key !== 'Enter' && key !== 'e' && key !== 'u') return
      if (queued || visibleItems.length === 0) return
      const current = focusedIndex >= 0 ? visibleItems[focusedIndex] : null
      if (key === 'j' || key === 'k') {
        event.preventDefault()
        const next =
          focusedIndex < 0
            ? key === 'j'
              ? 0
              : visibleItems.length - 1
            : Math.min(visibleItems.length - 1, Math.max(0, focusedIndex + (key === 'j' ? 1 : -1)))
        focusRow(visibleItems[next].id)
        return
      }
      if (!current) return
      if (key === 'Enter' && event.target instanceof HTMLElement && event.target.closest('button, a')) return
      event.preventDefault()
      if (key === 'Enter') {
        root.querySelector<HTMLAnchorElement>(`[data-item-id="${CSS.escape(current.id)}"] [data-testid="inbox-item-link"]`)?.click()
        return
      }
      if (key === 'e') {
        if (current.archived) onUnarchive(current.id)
        else onArchive(current.id)
        const neighbour = visibleItems[focusedIndex + 1] ?? visibleItems[focusedIndex - 1]
        if (neighbour) focusRow(neighbour.id)
        else setFocusedId(null)
        return
      }
      if (!current.read) void markRead([current.id])
      else if (current.state !== 'inert' && !current.archived) void markUnread([current.id])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queued, visibleItems, focusedIndex, focusRow, markRead, markUnread, onArchive, onUnarchive])

  const filterCount = (key: InboxFilter): number => (key === 'needsMe' ? shownPending : 0)
  const emptyKey = filter
  const failed = error && visibleItems.length === 0
  const move = useMotionToken(motionQuick)
  const exit = useMotionToken(motionQuickExit)

  return (
    <div
      ref={rootRef}
      className={cn('mx-auto w-full max-w-3xl space-y-4', className)}
      onFocus={trackFocus}
      onBlur={dropFocus}
    >
      {/* ---- Filter + bulk action ---- */}
      {/* `min-h-8` holds the toolbar's line even if the filter wraps, so a
          count arriving cannot lift the list. */}
      <div className="flex min-h-8 items-center justify-between gap-2">
        {/* One line at any width: on a phone the four filters ran off the
            screen's edge („Archivie…“) and the bulk action took a line of its
            own. The filters scroll sideways inside their own box instead. */}
        <div className="-mx-1 min-w-0 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ToggleGroup
          type="single"
          segmented
          variant="inverted"
          size="sm"
          value={filter}
          onValueChange={(value) => {
            if (isInboxFilter(value)) choose(value)
          }}
          aria-label={t('inbox.filters.ariaLabel')}
        >
          {FILTERS.map((key) => {
            const count = filterCount(key)
            return (
              <ToggleGroupItem key={key} value={key} aria-label={key === 'archived' ? t('inbox.filters.archived') : undefined}>
                {/* „Archiviert“ is the filter visited least, and on a phone its
                    word was the one pushed off the screen: there it is its icon. */}
                {key === 'archived' ? (
                  <>
                    <Archive aria-hidden className="sm:hidden" />
                    <span className="max-sm:hidden">{t('inbox.filters.archived')}</span>
                  </>
                ) : (
                  t(`inbox.filters.${key}`)
                )}
                {/* Only when there is a number to say: an invisible pill kept
                    a blank tail after the label at zero. */}
                {count > 0 && <CountPill count={count} className={cn(filter === key && 'bg-background/20 text-current')} />}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        </div>

        {/* Nothing to mark on an empty list, and nothing to read under
            „Archiviert“: the button would be a control with no job. */}
        {!queued && visibleItems.length > 0 && filter !== 'archived' && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={!hasUnread || mutating}
            aria-label={t('inbox.markAllRead')}
            title={t('inbox.markAllRead')}
            onClick={() => void markAllRead()}
          >
            <CheckCheck aria-hidden />
            <span className="max-sm:hidden">{t('inbox.markAllReadShort')}</span>
          </Button>
        )}
      </div>

      {/* Offered once, never forced (ADR-0112): shown only where this browser can
          show notifications and has not been asked. */}
      <NotificationPrompt />

      {/* A refused action — most often a row a second tab already archived. It
          belongs beside the list, not instead of it: replacing the rows with
          "your inbox could not be loaded" made a working inbox look broken and
          stated something that had not happened. */}
      {mutationError && (
        <Alert
          variant="destructive"
          className="animate-in fade-in-0 duration-snap ease-out motion-reduce:animate-none"
        >
          <AlertCircle />
          <AlertTitle className="line-clamp-none">{t('inbox.errors.actionFailed')}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3 pt-1">
            <Button variant="secondary" size="sm" onClick={dismissMutationError}>
              {t('sharing.errors.dismiss')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ---- The list itself ----
          The live region is the small `role="status"` node below, NOT this
          container: announcing the container meant a screen reader read the whole
          inbox — every row, title, body, excerpt and timestamp — on the first
          skeleton→rows swap, on every filter change and after every archive. */}
      {/* Focusable from code only: where the focus goes when the last row leaves with it. */}
      {queued ? (
        <InboxQueue enabled={enabled} />
      ) : (
      <div ref={listRef} data-testid="inbox-list" tabIndex={-1} className="outline-none">
        {/* A read that failed with rows on screen keeps them: a re-read in the
            background (a live nudge, the poll) that failed once used to replace a
            working list with „konnte nicht geladen werden“. The next read says. */}
        {failed ? (
          <LoadError title={t('inbox.errors.loadFailed')} onRetry={() => refresh()} />
        ) : loading ? (
          <ItemList
            as="ul"
            data-testid="inbox-skeleton"
            aria-busy="true"
            className="border-0 bg-card shadow-xs animate-in fade-in-0 duration-quick ease-out fill-mode-backwards delay-(--motion-quick) motion-reduce:animate-none"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <Item as="li" key={index} className="items-start py-3.5">
                <ItemMedia>
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                </ItemMedia>
                <ItemContent className="flex flex-col gap-2">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-2.5 w-1/3" />
                  <Skeleton className="h-2.5 w-20" />
                </ItemContent>
              </Item>
            ))}
          </ItemList>
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={EMPTY_ICON[emptyKey]}
            title={t(`inbox.empty.${emptyKey}Title`)}
            description={t(`inbox.empty.${emptyKey}Description`)}
          />
        ) : (
          <div className="space-y-5">
            {/* A section leaves with its last row and the ones under it close
                the gap (`layout`). It used to unmount in one frame, taking the
                row's exit with it, and everything below jumped. Keyed by its
                span, not its place, so the sections under one that left are
                still themselves. */}
            <AnimatePresence initial={false} mode="popLayout">
            {keyedSections(inboxSections(visibleItems, new Date())).map(({ key, section }) => (
              <motion.section
                key={key}
                layout="position"
                exit={{ opacity: 0, transition: exit }}
                transition={move}
                aria-labelledby={`inbox-section-${key}`}
                data-testid="inbox-section"
              >
                <SectionLabel as="h3" id={`inbox-section-${key}`} className="mb-2 block px-1">
                  {t(`inbox.groups.${section.group}`)}
                </SectionLabel>
                <ItemList as="ul" className="border-0 bg-card shadow-xs">
                  {/* Archiving a row is the one action here, and it removes that row —
                      so the list needs an exit, which CSS cannot give it, and `layout`
                      so the rows below close the gap instead of jumping.

                      No entrance stagger. The inbox is a work queue people open to
                      triage, and a cascade makes the first glance slower every single
                      time for a flourish that only reads once. Motion here is reserved
                      for a change the user causes. */}
                  <AnimatePresence initial={false} mode="popLayout">
                    {section.items.map((item) => (
                      <InboxItemRow
                        key={item.id}
                        item={item}
                        focused={item.id === focusedId}
                        viewerId={viewerId}
                        onOpen={onOpen}
                        onArchive={onArchive}
                        onUnarchive={onUnarchive}
                        onMarkRead={(itemId) => void markRead([itemId])}
                        onMarkUnread={(itemId) => void markUnread([itemId])}
                      />
                    ))}
                  </AnimatePresence>
                </ItemList>
              </motion.section>
            ))}
            </AnimatePresence>
          </div>
        )}
        {/* The list stopped at a page and used to say nothing about it. */}
        {!failed && !loading && (
          <LoadMore
            hasMore={hasMore}
            loading={loadingMore}
            failed={loadMoreFailed}
            onLoadMore={loadMore}
            loadMoreLabel={t('inbox.loadMore')}
            loadingLabel={t('inbox.loadingMore')}
            failedLabel={t('inbox.loadMoreFailed')}
          />
        )}
      </div>
      )}

      {/* The list's keys were there and nowhere said: a quiet line under the
          rows, where a pointer and a keyboard are (a phone has neither). Aria-
          hidden: the shortcuts sheet is where a screen reader learns them. */}
      {!failed && !loading && (queued || visibleItems.length > 0) && (
        <p
          aria-hidden
          data-testid="inbox-key-hint"
          className="hidden flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground pointer-fine:flex"
        >
          <span className="inline-flex items-center gap-1"><KbdGroup><Kbd>j</Kbd><Kbd>k</Kbd></KbdGroup>{t('inbox.keys.move')}</span>
          <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd>{t('inbox.keys.open')}</span>
          <span className="inline-flex items-center gap-1"><Kbd>e</Kbd>{t('inbox.keys.archive')}</span>
          <span className="inline-flex items-center gap-1"><Kbd>u</Kbd>{t('inbox.keys.read')}</span>
        </p>
      )}

      {/* The whole announcement, in one always-mounted node: how many things need
          this person. A live region that is created at the same moment as its
          content is routinely dropped by screen readers, so it is mounted whether
          or not there is anything to say.

          Nothing to say is the literal case at zero: "0 items need your attention"
          is not news, and this region is re-read on every filter change and after
          every archive — so an empty queue interrupted the reader to tell them
          about nothing, over and over. */}
      <p className="sr-only" role="status" aria-live="polite">
        {(loading && !queued) || shownPending === 0
          ? ''
          : shownPending === 1
            ? t('inbox.badgeAriaOne')
            : t('inbox.badgeAria', { count: shownPending })}
      </p>
    </div>
  )
}
