'use client'

import type { JSX, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { projectIdFromPathname } from '@/components/shell/org-sections'
import { PERSONAL_CHAT_PATH, railModeOf } from '@/components/shell/rail-mode'
import { RAIL_CHAT_LIMIT, RailChatsSource, type RailChats } from '@/components/shell/rail-chats'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import { useSessionRows } from '../hooks/use-session-rows'
import { useLayoutStore } from '../store'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'

export function chatPathOf(projectId: string | null): string {
  return projectId ? `/app/projects/${encodeURIComponent(projectId)}/chat` : PERSONAL_CHAT_PATH
}

const under = (pathname: string, base: string): boolean => pathname === base || pathname.startsWith(`${base}/`)

export function RailChatsProvider({ children, pathname: pathnameOverride }: { children: ReactNode; pathname?: string }): JSX.Element {
  const routerPathname = usePathname()
  const pathname = pathnameOverride ?? routerPathname ?? ''
  const projectId = projectIdFromPathname(pathname)
  const mode = railModeOf(pathname)
  const rows = useSessionRows(null)
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
  const projectOf = useMemo(() => new Map(rows.map((row) => [row.id, row.projectId])), [rows])

  const onOpen = useCallback(
    (id: string) => {
      if (onChatPath(projectOf.get(id) ?? null)) selectConversation(id)
    },
    [onChatPath, projectOf, selectConversation]
  )
  const onOpenAll = useCallback(() => setSessionsPanelOpen(true), [setSessionsPanelOpen])

  const value = useMemo<RailChats | null>(() => {
    if (mode === null) return null
    return {
      items: rows.slice(0, RAIL_CHAT_LIMIT).map((row) => ({
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
    }
  }, [mode, rows, allHref, onChatPath, openId, onOpen, onOpenAll, updateConversationTitle, t, tCollab])

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
