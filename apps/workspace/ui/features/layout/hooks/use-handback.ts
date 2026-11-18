import { useCallback, useMemo, useState } from 'react'
import { useChatStore } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import type { useSharedThread } from '@/features/collaboration/hooks/use-shared-thread'
import type { Translator } from '@/i18n'
import { isAgentMentionId } from '@/lib/mentions/types'
import { LEGACY_AGENT_MENTION_ID } from '@/lib/mentions/legacy-mention-ids'

type SharedThread = ReturnType<typeof useSharedThread>

export function useHandback({
  shared,
  authorOf,
  currentUserId,
  threadAwaitsHuman,
  displayableMessages,
  tCollaboration,
}: {
  shared: SharedThread['shared']
  authorOf: SharedThread['authorOf']
  currentUserId: string | null
  threadAwaitsHuman: boolean
  displayableMessages: ChatMessage[]
  tCollaboration: Translator
}) {
  const setComposerPrefill = useChatStore((s) => s.setComposerPrefill)
  const [handbackDismissedFor, setHandbackDismissedFor] = useState<string | null>(null)

  const handback = useMemo((): {
    anchorId: string
    people: Array<{ userId: string; name: string }>
  } | null => {
    if (!shared || threadAwaitsHuman) return null

    const asked = new Set<string>()
    for (const message of displayableMessages) {
      if (message.addressees) {
        if (!message.addressees.agent) {
          for (const userId of message.addressees.users) asked.add(userId)
        }
        continue
      }
      const mentions = message.mentions ?? []
      if (mentions.length === 0) continue
      if (mentions.some((mention) => isAgentMentionId(mention.targetId))) continue
      for (const mention of mentions) asked.add(mention.targetId)
    }
    if (asked.size === 0) return null

    const answerers: Array<{ userId: string; name: string }> = []
    let anchorId: string | null = null
    for (let index = displayableMessages.length - 1; index >= 0; index -= 1) {
      const message = displayableMessages[index]
      const isUserMessage = message.messageType === 'user' || message.role === 'user'
      if (!isUserMessage) break
      const userId = message.authorUserId ?? null
      if (!userId || userId === currentUserId || !asked.has(userId)) break
      anchorId ??= message.id
      if (answerers.some((person) => person.userId === userId)) continue
      answerers.unshift({
        userId,
        name: authorOf(userId)?.name ?? message.authorName ?? tCollaboration('inbox.unknownActor'),
      })
    }
    if (!anchorId || answerers.length === 0) return null
    return { anchorId, people: answerers }
  }, [shared, threadAwaitsHuman, displayableMessages, currentUserId, authorOf, tCollaboration])

  const showHandback = handback !== null && handbackDismissedFor !== handback.anchorId

  const handleHandback = useCallback(() => {
    if (!handback) return
    const agentName = tCollaboration('mentions.picker.agentName')
    setComposerPrefill(`@${agentName} ${tCollaboration('mentions.handback.prefill')}`, [
      { targetId: LEGACY_AGENT_MENTION_ID, display: agentName },
    ])
    setHandbackDismissedFor(handback.anchorId)
  }, [handback, setComposerPrefill, tCollaboration])

  const handleAskAgent = useCallback(() => {
    const agentName = tCollaboration('mentions.picker.agentName')
    setComposerPrefill(`@${agentName} `, [{ targetId: LEGACY_AGENT_MENTION_ID, display: agentName }])
  }, [setComposerPrefill, tCollaboration])

  const handleAskBack = useCallback(
    (asker: { userId: string; name: string }) => {
      setComposerPrefill(`@${asker.name} `, [{ targetId: asker.userId, display: asker.name }])
    },
    [setComposerPrefill]
  )

  return {
    handback,
    showHandback,
    handleHandback,
    handleAskAgent,
    handleAskBack,
    setHandbackDismissedFor,
  }
}
