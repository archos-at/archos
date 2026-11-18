'use client'

import { useEffect, useState } from 'react'
import { conversationsClient, type RestrictingOtherProject } from '@/adapters/api/conversations-client'
import { useConversationOnServer } from '../lib/conversation-on-server'
import { useChatStore } from '../store'

const NONE: readonly RestrictingOtherProject[] = []

export function useRestrictingOtherProjects(conversationId: string | null | undefined): readonly RestrictingOtherProject[] {
  const [read, setRead] = useState<{ conversationId: string; projects: readonly RestrictingOtherProject[] } | null>(null)
  const onServer = useConversationOnServer(conversationId)
  const isStreaming = useChatStore((state) => state.isStreaming)
  const newestAnswerId = useChatStore((state) => {
    const messages = state.currentConversation?.messages ?? []
    return messages.findLast((message) => message.role === 'assistant')?.id ?? null
  })

  useEffect(() => {
    if (!conversationId || !onServer || isStreaming) return
    let current = true
    void conversationsClient.restrictingOtherProjects(conversationId).then((projects) => {
      if (current && projects) setRead({ conversationId, projects })
    })
    return () => {
      current = false
    }
  }, [conversationId, onServer, isStreaming, newestAnswerId])

  return read !== null && read.conversationId === conversationId ? read.projects : NONE
}
