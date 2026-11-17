import { useCallback, useRef, useState } from 'react'
import { useChatStore } from '@/features/chat/store'
import type {
  MentionPickerAria,
  MentionPickerHandle,
} from '@/features/collaboration/components/MentionPicker'
import { useMentionCandidates } from '@/features/collaboration/hooks/use-sharing'
import { findMentionQuery, type DraftMention, type MentionQuery } from '@/lib/mentions/mention-text'

interface ComposerMentionsInput {
  currentSessionId: string | undefined
  canCollaborate: boolean
  draftLocked: boolean
}

export function useComposerMentions({
  currentSessionId,
  canCollaborate,
  draftLocked,
}: ComposerMentionsInput) {
  const ensureSession = useChatStore((state) => state.ensureSession)
  const ensureConversationExists = useChatStore((state) => state._ensureConversationExists)
  const [mentions, setMentions] = useState<DraftMention[]>([])
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [mentionRequested, setMentionRequested] = useState(false)
  const [mentionAria, setMentionAria] = useState<MentionPickerAria>({
    listboxId: null,
    activeOptionId: null,
  })
  const mentionPickerRef = useRef<MentionPickerHandle>(null)

  const {
    data: mentionData,
    loading: mentionsLoading,
    restart: restartMentionCandidates,
  } = useMentionCandidates(currentSessionId ?? null, canCollaborate && mentionRequested)

  const mentionRetryRef = useRef<(() => void) | null>(null)
  mentionRetryRef.current =
    mentionData === null && !mentionsLoading ? restartMentionCandidates : null
  const ensureConversationRef = useRef<() => void>(() => {})
  ensureConversationRef.current = () => {
    ensureSession()
    void ensureConversationExists()
  }
  const mentionFragmentOpenRef = useRef(false)

  const syncMentionQuery = useCallback((value: string, caret: number | null) => {
    const range = caret === null ? null : findMentionQuery(value, caret)
    setMentionQuery(range)
    if (range) {
      if (!mentionFragmentOpenRef.current) {
        ensureConversationRef.current()
        mentionRetryRef.current?.()
      }
      mentionFragmentOpenRef.current = true
      setMentionRequested(true)
      return
    }
    mentionFragmentOpenRef.current = false
    setMentionDismissed(false)
  }, [])

  const mentionPickerOpen =
    canCollaborate &&
    mentionQuery !== null &&
    !mentionDismissed &&
    !draftLocked &&
    (mentionsLoading || mentionData !== null)

  return {
    mentions,
    setMentions,
    mentionQuery,
    setMentionQuery,
    setMentionDismissed,
    mentionAria,
    setMentionAria,
    mentionPickerRef,
    mentionData,
    mentionsLoading,
    syncMentionQuery,
    mentionPickerOpen,
  }
}
