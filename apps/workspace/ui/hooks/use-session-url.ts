'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSearchParams, usePathname } from 'next/navigation'
import { useChatStore } from '@/features/chat/store'
import { resumableSessionId } from '@/features/chat/lib/resume-session'
import { chatSideOf } from '@/components/shell/rail-mode'
import { conversationMatchesProject } from '@/features/chat/lib/project-scope'

interface UseSessionUrlOptions {
  isAuthenticated: boolean
}

const replaceUrlWithoutServerRender = (url: string): void => {
  window.history.replaceState(null, '', url)
}

interface UseSessionUrlReturn {
  updateSessionUrl: (sessionId: string | null) => void
  clearSessionUrl: () => void
}

function openOnThisSide(state: {
  currentConversation: { id: string; userId?: string | null; projectId?: string | null } | null
  currentUserId: string | null
  projectId?: string | null
}): string | null {
  const open = state.currentConversation
  return open && open.userId === state.currentUserId && conversationMatchesProject(open, state.projectId) ? open.id : null
}

export function useSessionUrl({ isAuthenticated }: UseSessionUrlOptions): UseSessionUrlReturn {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()

  const { currentConversationId, currentUserId, conversationIds, serverConversationsLoaded } =
    useChatStore(
      useShallow((s) => ({
        currentConversationId: s.currentConversation?.id,
        currentUserId: s.currentUserId,
        conversationIds: s.conversations.map((c) => c.id).join('\n'),
        serverConversationsLoaded: s.serverConversationsLoaded,
      })),
    )
  const scope = useChatStore((s) => s.projectId)
  const pageSide = chatSideOf(pathname)
  const scopeIsThePage = pageSide === undefined || (scope ?? null) === pageSide
  const selectConversation = useChatStore((s) => s.selectConversation)
  const openHere = useChatStore(openOnThisSide)
  const getUserConversations = useChatStore((s) => s.getUserConversations)

  const initialSyncDone = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || !currentUserId || !searchParams || !pathname || initialSyncDone.current)
      return
    if (!scopeIsThePage) return

    const sessionId = searchParams.get('session')
    if (!sessionId) {
      const resumeId = openHere ?? resumableSessionId(getUserConversations())
      if (resumeId) {
        selectConversation(resumeId)
        const params = new URLSearchParams(searchParams.toString())
        params.set('session', resumeId)
        replaceUrlWithoutServerRender(`${pathname}?${params.toString()}`)
      }
      initialSyncDone.current = true
      return
    }

    const userConversations = getUserConversations()
    const sessionExists = userConversations.some((c) => c.id === sessionId)

    if (sessionExists) {
      selectConversation(sessionId)
    } else if (!serverConversationsLoaded) {
      return
    } else {
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('session')
      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      replaceUrlWithoutServerRender(newUrl)
    }

    initialSyncDone.current = true
  }, [
    isAuthenticated,
    currentUserId,
    searchParams,
    pathname,
    selectConversation,
    getUserConversations,
    conversationIds,
    serverConversationsLoaded,
    scopeIsThePage,
  ])

  useEffect(() => {
    if (!isAuthenticated || !currentUserId || !searchParams || !pathname || !initialSyncDone.current)
      return
    if (!scopeIsThePage) return

    const urlSessionId = searchParams.get('session')
    const currentSessionId = currentConversationId

    if (currentSessionId && currentSessionId !== urlSessionId) {
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.set('session', currentSessionId)
      replaceUrlWithoutServerRender(`${pathname}?${newParams.toString()}`)
    } else if (!currentSessionId && urlSessionId) {
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('session')
      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      replaceUrlWithoutServerRender(newUrl)
    }
  }, [isAuthenticated, currentUserId, currentConversationId, searchParams, pathname, scopeIsThePage])

  const updateSessionUrl = useCallback(
    (sessionId: string | null) => {
      if (!pathname) return
      const currentParams = searchParams?.toString() ?? ''
      const newParams = new URLSearchParams(currentParams)

      if (sessionId) {
        newParams.set('session', sessionId)
      } else {
        newParams.delete('session')
      }

      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      replaceUrlWithoutServerRender(newUrl)
    },
    [searchParams, pathname]
  )

  const clearSessionUrl = useCallback(() => {
    updateSessionUrl(null)
  }, [updateSessionUrl])

  return {
    updateSessionUrl,
    clearSessionUrl,
  }
}
