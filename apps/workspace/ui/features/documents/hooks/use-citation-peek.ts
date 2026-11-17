'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useChatStore } from '@/features/chat/store'
import {
  latestFinishedAssistantMessage,
  peekableFileForMessage,
} from '@/features/chat/lib/citation-peek'
import { openFilePeek } from '../lib/open-file-peek'
import { useSurfacedDocuments } from './use-surfaced-documents'

export function useCitationPeek(options: {
  projectId: string | null
  projectName?: string | null
  canCollaborate?: boolean
}): void {
  const { projectId, projectName, canCollaborate } = options
  const message = useChatStore((state) =>
    latestFinishedAssistantMessage(state.currentConversation?.messages),
  )
  const handledMessageId = useRef<string | null>(null)

  const decision = useMemo(() => {
    if (!message) return null
    return { messageId: message.id, peek: peekableFileForMessage(message) }
  }, [message])

  const surfaced = useMemo(
    () =>
      decision?.peek
        ? [{ file_name: decision.peek.fileName, source: decision.peek.source }]
        : [],
    [decision],
  )
  const { resolved, isLoading } = useSurfacedDocuments(surfaced, projectId)

  useEffect(() => {
    if (!decision) return
    if (handledMessageId.current === decision.messageId) return

    if (!decision.peek) {
      handledMessageId.current = decision.messageId
      return
    }
    if (isLoading) return

    handledMessageId.current = decision.messageId
    const file = resolved[0]?.file
    if (!file) return

    openFilePeek({
      file,
      source: decision.peek.source,
      projectId,
      projectName,
      canCollaborate,
    })
  }, [decision, isLoading, resolved, projectId, projectName, canCollaborate])
}
