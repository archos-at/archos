'use client'

import type { JSX, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'

import { projectIdFromPathname } from '@/components/shell/org-sections'
import { RAIL_CHAT_LIMIT, RailChatsSource, type RailChats } from '@/components/shell/rail-chats'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import { useSessionRows } from '../hooks/use-session-rows'
import { useLayoutStore } from '../store'

export function RailChatsProvider({ children, pathname: pathnameOverride }: { children: ReactNode; pathname?: string }): JSX.Element {
  const routerPathname = usePathname()
  const pathname = pathnameOverride ?? routerPathname ?? ''
  const projectId = projectIdFromPathname(pathname)
  const rows = useSessionRows(projectId)
  const openId = useChatStore((s) => s.currentConversation?.id ?? null)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const setSessionsPanelOpen = useLayoutStore((s) => s.setSessionsPanelOpen)
  const t = useTranslations(researchCopy)
  const tCollab = useTranslations(collaborationCopy)

  const chatHref = projectId ? `/app/projects/${encodeURIComponent(projectId)}/chat` : ''
  const onChatRoute = chatHref !== '' && (pathname === chatHref || pathname.startsWith(`${chatHref}/`))

  const onOpen = useCallback(
    (id: string) => {
      if (onChatRoute) selectConversation(id)
    },
    [onChatRoute, selectConversation]
  )
  const onOpenAll = useCallback(() => setSessionsPanelOpen(true), [setSessionsPanelOpen])

  const value = useMemo<RailChats | null>(() => {
    if (!projectId) return null
    return {
      items: rows.slice(0, RAIL_CHAT_LIMIT).map((row) => ({
        id: row.id,
        title: row.contentLocked ? tCollab('rightsLost.neutralTitle') : row.title.trim() || t('sessionsPanel.untitledSession'),
        href: `${chatHref}?session=${encodeURIComponent(row.id)}`,
        current: onChatRoute && row.id === openId,
        temporary: row.temporary,
      })),
      allHref: chatHref,
      onOpen,
      onOpenAll,
    }
  }, [projectId, rows, chatHref, onChatRoute, openId, onOpen, onOpenAll, t, tCollab])

  return <RailChatsSource value={value}>{children}</RailChatsSource>
}
