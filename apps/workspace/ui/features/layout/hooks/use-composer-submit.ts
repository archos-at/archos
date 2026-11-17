import { useCallback, useEffect, type KeyboardEvent, type RefObject } from 'react'
import { toast } from 'sonner'
import type { useWebSocketChat } from '@/features/chat'
import { useChatStore } from '@/features/chat/store'
import { resolveAddressee, sendMessageOptions } from '@/features/collaboration/lib/composer-routing'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { researchCopy } from '@/i18n/namespaces/research'
import { bumpThreadRevision } from '@/shared/collaboration/thread-sharing'
import type { DraftMention, MentionQuery } from '@/lib/mentions/mention-text'
import type { MaskedText } from '@/lib/upload-screening/content-screen'
import {
  SEND_CONTROL_SWAP_GUARD_MS,
  mentionRefusalMessage,
  normalizeSendResult,
  releaseSoftKeyboard,
} from '../components/input-area/composer-helpers'
import type { ScreeningHold } from '../components/input-area/composer-types'

interface ComposerSubmitInput {
  wsChat: ReturnType<typeof useWebSocketChat>
  message: string
  setMessage: (value: string) => void
  mentions: DraftMention[]
  setMentions: (value: DraftMention[]) => void
  setMentionQuery: (value: MentionQuery | null) => void
  canCollaborate: boolean
  threadAwaitsHuman: boolean
  currentConversationId: string | undefined
  disabled: boolean
  steering: boolean
  isResponseMode: boolean
  showStop: boolean
  pendingCount: number
  heldForUpload: string | null
  setHeldForUpload: (value: string | null) => void
  screeningHold: ScreeningHold | null
  setScreeningHold: (value: ScreeningHold | null) => void
  screenChat: (text: string) => MaskedText
  onStoppedTyping: () => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  sendControlSwappedAtRef: { current: number }
}

export function useComposerSubmit({
  wsChat,
  message,
  setMessage,
  mentions,
  setMentions,
  setMentionQuery,
  canCollaborate,
  threadAwaitsHuman,
  currentConversationId,
  disabled,
  steering,
  isResponseMode,
  showStop,
  pendingCount,
  heldForUpload,
  setHeldForUpload,
  screeningHold,
  setScreeningHold,
  screenChat,
  onStoppedTyping,
  textareaRef,
  sendControlSwappedAtRef,
}: ComposerSubmitInput) {
  const t = useTranslations(researchCopy)
  const tCollab = useTranslations(collaborationCopy)
  const clearComposerDraft = useChatStore((state) => state.clearComposerDraft)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const { sendMessage, respondToInteraction, noteSendIntent, steer } = wsChat

  const handleSubmit = useCallback(
    async (heldText?: string, maskedText?: string) => {
      const source = maskedText ?? heldText ?? message
      if (!source.trim() || (disabled && !steering)) return
      noteSendIntent()
      const currentMessage = source.trim()

      if (maskedText === undefined) {
        const screened = screenChat(currentMessage)
        if (screened.findings.length > 0) {
          setScreeningHold({ original: currentMessage, masked: screened, heldText })
          return
        }
      }
      const submittingSessionId = currentConversationId

      if (disabled && steering) {
        if (!steer({ text: currentMessage })) return
        setMessage('')
        setMentionQuery(null)
        onStoppedTyping()
        if (submittingSessionId) clearComposerDraft(submittingSessionId)
        return
      }

      if (isResponseMode && respondToInteraction) {
        setMessage('')
        releaseSoftKeyboard(textareaRef.current)
        onStoppedTyping()
        if (submittingSessionId) clearComposerDraft(submittingSessionId)
        respondToInteraction(currentMessage)
        return
      }

      const sent = resolveAddressee({
        text: currentMessage,
        mentions,
        awaitingHuman: threadAwaitsHuman,
        canCollaborate,
      })
      const sentHumans = sent.humans

      if (heldText === undefined && pendingCount > 0) {
        setHeldForUpload(currentMessage)
        setMessage('')
        setMentionQuery(null)
        onStoppedTyping()
        return
      }

      setMessage('')
      setMentionQuery(null)
      releaseSoftKeyboard(textareaRef.current)
      onStoppedTyping()
      try {
        const { ok, outcome } = normalizeSendResult(
          await (() => {
            const options = sendMessageOptions(sent.routing)
            return options ? sendMessage(currentMessage, options) : sendMessage(currentMessage)
          })()
        )
        if (!ok) {
          setMessage(currentMessage)
          const refusal = mentionRefusalMessage(outcome, sentHumans, tCollab)
          toast.error(refusal ?? t('inputArea.messageNotSent'), {
            description: refusal ? undefined : t('inputArea.messageNotSentDesc'),
          })
          return
        }
        if (submittingSessionId) clearComposerDraft(submittingSessionId)
        setMentions([])
        if (sent.mentions.length > 0 && submittingSessionId) {
          bumpThreadRevision(submittingSessionId)
        }
      } catch (error) {
        console.error('Failed to send message:', error)
        setMessage(currentMessage)
        toast.error(t('inputArea.messageNotSent'), {
          description: t('inputArea.messageNotSentDesc'),
        })
      }
    },
    [
      message,
      mentions,
      disabled,
      steering,
      steer,
      pendingCount,
      isResponseMode,
      respondToInteraction,
      sendMessage,
      noteSendIntent,
      screenChat,
      threadAwaitsHuman,
      canCollaborate,
      currentConversationId,
      clearComposerDraft,
      onStoppedTyping,
      t,
      tCollab,
    ]
  )

  useEffect(() => {
    if (heldForUpload === null || pendingCount > 0) return
    const text = heldForUpload
    setHeldForUpload(null)
    void handleSubmit(text)
  }, [heldForUpload, pendingCount, handleSubmit])

  const sendScreenedMasked = useCallback(() => {
    if (screeningHold === null) return
    setScreeningHold(null)
    void handleSubmit(screeningHold.heldText, screeningHold.masked.text)
  }, [screeningHold, handleSubmit])

  const editScreened = useCallback(() => {
    if (screeningHold === null) return
    setScreeningHold(null)
    if (screeningHold.heldText !== undefined && !message.trim()) setMessage(screeningHold.original)
    textareaRef.current?.focus()
  }, [screeningHold, message])

  const sendHeldNow = useCallback(() => {
    if (heldForUpload === null) return
    const text = heldForUpload
    setHeldForUpload(null)
    void handleSubmit(text)
  }, [heldForUpload, handleSubmit])

  const handleSendControlClick = useCallback(() => {
    if (performance.now() - sendControlSwappedAtRef.current < SEND_CONTROL_SWAP_GUARD_MS) return
    if (showStop) {
      stopStreaming?.()
      return
    }
    void handleSubmit()
  }, [showStop, stopStreaming, handleSubmit])

  const handleSendControlKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat && e.key === 'Enter') e.preventDefault()
  }, [])

  return {
    handleSubmit,
    sendScreenedMasked,
    editScreened,
    sendHeldNow,
    handleSendControlClick,
    handleSendControlKeyDown,
  }
}
