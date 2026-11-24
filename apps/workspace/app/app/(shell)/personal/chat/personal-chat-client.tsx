'use client'

import { type ReactNode, Suspense, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/adapters/auth'
import { MainLayout } from '@/features/layout'
import { useChatStore } from '@/features/chat/store'

export function opensHere(conversation: { projectId?: string | null; userId: string }, userId: string): boolean {
  return !conversation.projectId && conversation.userId === userId
}

const PersonalChatContent = ({ canCollaborate }: { canCollaborate: boolean }): ReactNode => {
  const { isAuthenticated, signIn } = useAuth()
  const setProjectId = useChatStore((s) => s.setProjectId)
  const loadServerConversations = useChatStore((s) => s.loadServerConversations)
  const startNewSessionDraft = useChatStore((s) => s.startNewSessionDraft)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const conversationCount = useChatStore((s) => s.conversations.length)
  const serverLoaded = useChatStore((s) => s.serverConversationsLoaded)
  const userId = useChatStore((s) => s.currentUserId)
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    setProjectId(null)
    void loadServerConversations()
  }, [setProjectId, loadServerConversations])

  const newParam = searchParams?.get('new') ?? null
  const consumedNew = useRef(false)
  useEffect(() => {
    if (!newParam || !isAuthenticated || consumedNew.current) return
    consumedNew.current = true
    startNewSessionDraft()
    if (pathname) router.replace(pathname, { scroll: false })
  }, [newParam, isAuthenticated, pathname, router, startNewSessionDraft])

  const sessionParam = searchParams?.get('session') ?? null
  const hydrated = useRef<string | null>(null)
  useEffect(() => {
    if (!isAuthenticated || !sessionParam || newParam || !userId || hydrated.current === sessionParam) return
    const target = useChatStore.getState().conversations.find((c) => c.id === sessionParam)
    if (!target) {
      if (serverLoaded) hydrated.current = sessionParam
      return
    }
    hydrated.current = sessionParam
    if (opensHere(target, userId)) selectConversation(sessionParam)
  }, [isAuthenticated, sessionParam, newParam, userId, conversationCount, serverLoaded, selectConversation])

  return <MainLayout isAuthenticated={isAuthenticated} onSignIn={signIn} canCollaborate={canCollaborate} canChatInProject />
}

export const PersonalChatClient = ({ canCollaborate }: { canCollaborate: boolean }): ReactNode => (
  <Suspense fallback={null}>
    <PersonalChatContent canCollaborate={canCollaborate} />
  </Suspense>
)
