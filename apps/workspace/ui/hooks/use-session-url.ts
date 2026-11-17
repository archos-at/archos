'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useChatStore } from '@/features/chat/store'
import { resumableSessionId } from '@/features/chat/lib/resume-session'

interface UseSessionUrlOptions {
  isAuthenticated: boolean
}

interface UseSessionUrlReturn {
  updateSessionUrl: (sessionId: string | null) => void
  clearSessionUrl: () => void
}

export function useSessionUrl({ isAuthenticated }: UseSessionUrlOptions): UseSessionUrlReturn {
  const router = useRouter()
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
  const selectConversation = useChatStore((s) => s.selectConversation)
  const getUserConversations = useChatStore((s) => s.getUserConversations)

  const initialSyncDone = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || !currentUserId || !searchParams || !pathname || initialSyncDone.current)
      return

    const sessionId = searchParams.get('session')
    if (!sessionId) {
      const resumeId = resumableSessionId(getUserConversations())
      if (resumeId) {
        selectConversation(resumeId)
        const params = new URLSearchParams(searchParams.toString())
        params.set('session', resumeId)
        router.replace(`${pathname}?${params.toString()}`)
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
      router.replace(newUrl)
    }

    initialSyncDone.current = true
  }, [
    isAuthenticated,
    currentUserId,
    searchParams,
    pathname,
    router,
    selectConversation,
    getUserConversations,
    conversationIds,
    serverConversationsLoaded,
  ])

  useEffect(() => {
    if (!isAuthenticated || !currentUserId || !searchParams || !pathname || !initialSyncDone.current)
      return

    const urlSessionId = searchParams.get('session')
    const currentSessionId = currentConversationId

    if (currentSessionId && currentSessionId !== urlSessionId) {
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.set('session', currentSessionId)
      router.replace(`${pathname}?${newParams.toString()}`)
    } else if (!currentSessionId && urlSessionId) {
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('session')
      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      router.replace(newUrl)
    }
  }, [isAuthenticated, currentUserId, currentConversationId, searchParams, pathname, router])

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
      router.replace(newUrl)
    },
    [searchParams, pathname, router]
  )

  const clearSessionUrl = useCallback(() => {
    updateSessionUrl(null)
  }, [updateSessionUrl])

  return {
    updateSessionUrl,
    clearSessionUrl,
  }
}
