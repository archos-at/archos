'use client'

import { type ReactNode, Suspense, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/adapters/auth'
import { MainLayout } from '@/features/layout'
import { useChatStore } from '@/features/chat/store'
import { ChatArrivalProvider, type ChatArrival } from '@/features/layout/hooks/use-thread-phase'

interface PersonalChatClientProps {
  canCollaborate: boolean
  arrival?: ChatArrival
}

const NO_ARRIVAL: ChatArrival = {}

export function opensHere(conversation: { projectId?: string | null; userId: string }, userId: string): boolean {
  return !conversation.projectId && conversation.userId === userId
}

const PersonalChatContent = ({ canCollaborate, arrival }: PersonalChatClientProps): ReactNode => {
  const { isAuthenticated, signIn } = useAuth()
  const enterSide = useChatStore((s) => s.enterSide)
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
    enterSide(null)
    void loadServerConversations(undefined, 'personal')
  }, [enterSide, loadServerConversations])

  const newParam = searchParams?.get('new') ?? null
  const consumedNew = useRef(false)
  useEffect(() => {
    if (!newParam || !isAuthenticated || consumedNew.current) return
    consumedNew.current = true
    startNewSessionDraft()
    if (pathname) router.replace(pathname, { scroll: false })
  }, [newParam, isAuthenticated, pathname, router, startNewSessionDraft])

  const sessionParam = searchParams?.get('session') ?? null
  useEffect(() => {
    if (sessionParam) void loadServerConversations(undefined, 'personal', sessionParam)
  }, [sessionParam, loadServerConversations])
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

  return (
    <ChatArrivalProvider value={arrival ?? NO_ARRIVAL}>
      <MainLayout isAuthenticated={isAuthenticated} onSignIn={signIn} canCollaborate={canCollaborate} canChatInProject />
    </ChatArrivalProvider>
  )
}

export const PersonalChatClient = ({ canCollaborate, arrival }: PersonalChatClientProps): ReactNode => (
  <Suspense fallback={null}>
    <PersonalChatContent canCollaborate={canCollaborate} arrival={arrival} />
  </Suspense>
)
