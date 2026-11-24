'use client'

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { projectIdFromPathname } from '@/components/shell/org-sections'
import { PERSONAL_CHAT_PATH, railModeOf } from '@/components/shell/rail-mode'
import { readRecentProjectIds } from '@/components/shell/recent-projects'
import { shownSide, useRailSide } from '@/components/shell/rail-side'
import { RAIL_CHAT_LIMIT, RailChatsSource, type RailChats } from '@/components/shell/rail-chats'
import { useChatStore } from '@/features/chat/store'
import { serverSideKey } from '@/features/chat/stores/server-sides'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import { useSessionRows } from '../hooks/use-session-rows'
import { useLayoutStore } from '../store'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'

export function chatPathOf(projectId: string | null): string {
  return projectId ? `/app/projects/${encodeURIComponent(projectId)}/chat` : PERSONAL_CHAT_PATH
}

export function confirmedOnSide<T extends { id: string; createdAt: Date; untouched: boolean }>(
  rows: readonly T[],
  listing: { ids: readonly string[]; since: number } | undefined,
  isOpen: (row: T) => boolean
): T[] {
  const confirmed = new Set(listing?.ids ?? [])
  return rows.filter(
    (row) => !row.untouched && (isOpen(row) || confirmed.has(row.id) || (listing !== undefined && +new Date(row.createdAt) >= listing.since))
  )
}

export function newestWithCurrent<T>(rows: readonly T[], limit: number, isCurrent: (row: T) => boolean): T[] {
  const newest = rows.slice(0, limit)
  if (newest.some(isCurrent)) return newest
  const current = rows.find(isCurrent)
  return current ? [...rows.slice(0, limit - 1), current] : newest
}

const under = (pathname: string, base: string): boolean => pathname === base || pathname.startsWith(`${base}/`)

export function RailChatsProvider({ children, pathname: pathnameOverride }: { children: ReactNode; pathname?: string }): JSX.Element {
  const routerPathname = usePathname()
  const pathname = pathnameOverride ?? routerPathname ?? ''
  const routeMode = railModeOf(pathname)
  const pending = useRailSide((state) => state.pending)
  const shown = shownSide(pending, routeMode ? { mode: routeMode, projectId: projectIdFromPathname(pathname) } : null)
  const mode = shown?.mode ?? null
  const projectId = shown?.projectId ?? null
  const side = mode === 'project' ? projectId : null
  const sideRows = useSessionRows(side)
  const listing = useChatStore((s) => (mode === null ? undefined : s.serverSides[serverSideKey(mode, side)]))
  const loadServerConversations = useChatStore((s) => s.loadServerConversations)
  const openId = useChatStore((s) => s.currentConversation?.id ?? null)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const setSessionsPanelOpen = useLayoutStore((s) => s.setSessionsPanelOpen)
  const updateConversationTitle = useChatStore((s) => s.updateConversationTitle)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const router = useRouter()
  const [deleting, setDeleting] = useState<string | null>(null)
  const t = useTranslations(researchCopy)
  const tCollab = useTranslations(collaborationCopy)

  const allHref = chatPathOf(mode === 'personal' ? null : projectId)
  const onChatPath = useCallback((rowProjectId: string | null) => under(pathname, chatPathOf(rowProjectId)), [pathname])
  const rows = useMemo(
    () => confirmedOnSide(sideRows, listing, (row) => onChatPath(row.projectId) && row.id === openId),
    [sideRows, listing, onChatPath, openId]
  )
  const projectOf = useMemo(() => new Map(rows.map((row) => [row.id, row.projectId])), [rows])

  const onOpen = useCallback(
    (id: string) => {
      if (onChatPath(projectOf.get(id) ?? null)) selectConversation(id)
    },
    [onChatPath, projectOf, selectConversation]
  )
  const onOpenAll = useCallback(() => setSessionsPanelOpen(true), [setSessionsPanelOpen])

  const loadSide = useCallback(
    (sideProjectId: string | null): void => {
      void (sideProjectId ? loadServerConversations(sideProjectId, 'project') : loadServerConversations(undefined, 'personal'))
    },
    [loadServerConversations]
  )
  const onWarmOtherSide = useCallback((): void => {
    if (mode === 'project') loadSide(null)
    const recent = mode === 'personal' ? readRecentProjectIds()[0] : undefined
    if (recent) loadSide(recent)
  }, [mode, loadSide])

  useEffect(() => {
    if (mode === 'personal') loadSide(null)
    else if (mode === 'project' && projectId) loadSide(projectId)
  }, [mode, projectId, loadSide])
  const warmedOnMount = useRef(false)
  useEffect(() => {
    if (mode === null || warmedOnMount.current) return
    warmedOnMount.current = true
    onWarmOtherSide()
  }, [mode, onWarmOtherSide])

  const value = useMemo<RailChats | null>(() => {
    if (mode === null) return null
    return {
      items: newestWithCurrent(rows, RAIL_CHAT_LIMIT, (row) => onChatPath(row.projectId) && row.id === openId).map((row) => ({
        id: row.id,
        title: row.contentLocked ? tCollab('rightsLost.neutralTitle') : row.title.trim() || t('sessionsPanel.untitledSession'),
        href: `${chatPathOf(row.projectId)}?session=${encodeURIComponent(row.id)}`,
        current: onChatPath(row.projectId) && row.id === openId,
        temporary: row.temporary,
        projectId: row.projectId,
        shared: row.shared,
        locked: row.contentLocked,
        activity: row.activity,
      })),
      chatOpen: rows.some((row) => onChatPath(row.projectId) && row.id === openId),
      allHref,
      onOpen,
      onOpenAll,
      onRename: updateConversationTitle,
      onDelete: setDeleting,
      onWarmOtherSide,
      more: rows.length > RAIL_CHAT_LIMIT,
    }
  }, [mode, rows, allHref, onChatPath, openId, onOpen, onOpenAll, updateConversationTitle, onWarmOtherSide, t, tCollab])

  const confirmDelete = (): void => {
    if (!deleting) return
    const deletedChatPath = chatPathOf(projectOf.get(deleting) ?? null)
    deleteConversation(deleting)
    if (under(pathname, deletedChatPath) && deleting === openId) router.replace(deletedChatPath)
    setDeleting(null)
  }

  return (
    <RailChatsSource value={value}>
      {children}
      <DeleteSessionConfirmationModal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={confirmDelete}
        sessionTitle={rows.find((row) => row.id === deleting)?.title}
      />
    </RailChatsSource>
  )
}
