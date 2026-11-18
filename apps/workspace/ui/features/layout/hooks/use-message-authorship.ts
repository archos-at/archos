import { useMemo } from 'react'
import type { UserMessageAuthor } from '@/features/chat/components/UserMessage'
import type { ChatMessage } from '@/features/chat/types'
import type { useSharedThread } from '@/features/collaboration/hooks/use-shared-thread'

type SharedThread = ReturnType<typeof useSharedThread>

export function useMessageAuthorship({
  shared,
  displayableMessages,
  authorOf,
  currentUserId,
}: {
  shared: SharedThread['shared']
  displayableMessages: ChatMessage[]
  authorOf: SharedThread['authorOf']
  currentUserId: string | null
}) {
  const authorship = useMemo(() => {
    const byMessageId = new Map<string, { author: UserMessageAuthor; grouped: boolean }>()
    if (!shared) return byMessageId

    let previousAuthorKey: string | null = null
    for (const message of displayableMessages) {
      const isUserMessage = message.messageType === 'user' || message.role === 'user'
      if (!isUserMessage) {
        previousAuthorKey = null
        continue
      }

      const userId = message.authorUserId ?? currentUserId ?? null
      const person = authorOf(userId)
      const key = userId ?? `unattributed:${message.id}`

      byMessageId.set(message.id, {
        author: {
          userId,
          name: person?.name ?? message.authorName ?? null,
          avatarUrl: person?.profilePictureUrl ?? message.authorAvatarUrl ?? null,
          isYou: Boolean(userId && currentUserId && userId === currentUserId),
        },
        grouped: key === previousAuthorKey,
      })
      previousAuthorKey = key
    }
    return byMessageId
  }, [shared, displayableMessages, authorOf, currentUserId])

  return authorship
}
