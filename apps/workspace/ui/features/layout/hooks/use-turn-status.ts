import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatStoreWithHydration } from '@/features/chat/store'
import type { ChatMessage } from '@/features/chat/types'
import type { Translator } from '@/i18n'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import {
  FOLD_HOLD_MS,
  answerGist,
  turnEnding,
} from '../components/chat-area/chat-area-helpers'

export function useTurnStatus({
  displayableMessages,
  currentConversation,
  currentUserMessageId,
  turns,
  turnLive,
  hydratedIds,
  prefersReducedMotion,
  failedTurnIdsRef,
  t,
}: {
  displayableMessages: ChatMessage[]
  currentConversation: ChatStoreWithHydration['currentConversation']
  currentUserMessageId: ChatStoreWithHydration['currentUserMessageId']
  turns: ChatStoreWithHydration['turns']
  turnLive: boolean
  hydratedIds: Set<string>
  prefersReducedMotion: boolean
  failedTurnIdsRef: { current: Set<string> }
  t: Translator
}) {
  const stableStepsRef = useRef(new Map<string, StoredThinkingStep[]>())

  const getStepsForUserMessage = (messageId: string): StoredThinkingStep[] => {
    const steps = (
      currentConversation?.messages.find((m) => m.id === messageId)?.thinkingSteps ?? []
    ).filter((step) => step.scope !== 'deep')
    const previous = stableStepsRef.current.get(messageId)
    if (
      previous &&
      previous.length === steps.length &&
      previous.every((step, i) => step === steps[i])
    ) {
      return previous
    }
    stableStepsRef.current.set(messageId, steps)
    return steps
  }

  const currentTurnHasSteps = currentUserMessageId
    ? getStepsForUserMessage(currentUserMessageId).length > 0
    : false
  const currentTurn = useMemo(() => {
    if (!currentUserMessageId) return null
    const index = displayableMessages.findIndex((m) => m.id === currentUserMessageId)
    if (index < 0) return null
    const rest = displayableMessages.slice(index + 1)
    const nextQuestion = rest.findIndex((m) => m.messageType === 'user' || m.role === 'user')
    const messages = nextQuestion >= 0 ? rest.slice(0, nextQuestion) : rest
    const answer = messages.find((m) => m.messageType === 'agent_response')
    return {
      messages,
      answerId: answer?.id ?? null,
      answerBegun: Boolean(
        answer && (answer.content.trim() || answer.answerMeta || answer.cards?.some(Boolean))
      ),
      stopped: answer?.stopped === true,
      failed: answer?.failed === true,
      gist: answer ? answerGist(answer) : '',
    }
  }, [currentUserMessageId, displayableMessages])

  const [answerBegunFor, setAnswerBegunFor] = useState<string | null>(null)
  if (currentTurn?.answerBegun && currentUserMessageId && answerBegunFor !== currentUserMessageId) {
    setAnswerBegunFor(currentUserMessageId)
  }
  const answerHasBegun =
    Boolean(currentTurn?.answerBegun) ||
    (currentUserMessageId !== null && answerBegunFor === currentUserMessageId)

  const renderedIdsRef = useRef(new Set<string>())
  const foldStarts =
    turnLive &&
    currentTurnHasSteps &&
    currentTurn?.answerBegun &&
    currentTurn.answerId &&
    !hydratedIds.has(currentTurn.answerId) &&
    !renderedIdsRef.current.has(currentTurn.answerId)
      ? currentTurn.answerId
      : null
  const [foldHoldId, setFoldHoldId] = useState<string | null>(null)
  const [releasedHoldId, setReleasedHoldId] = useState<string | null>(null)
  if (foldStarts && foldStarts !== foldHoldId && foldStarts !== releasedHoldId)
    setFoldHoldId(foldStarts)
  useEffect(() => {
    if (!foldHoldId || releasedHoldId === foldHoldId) return
    const timer = setTimeout(
      () => setReleasedHoldId(foldHoldId),
      prefersReducedMotion ? 0 : FOLD_HOLD_MS
    )
    return () => clearTimeout(timer)
  }, [foldHoldId, releasedHoldId, prefersReducedMotion])
  const holdId = foldStarts ?? foldHoldId
  const heldAnswerId = holdId && releasedHoldId !== holdId ? holdId : null

  const [turnNote, setTurnNote] = useState({ live: turnLive, text: '' })
  if (turnNote.live !== turnLive) {
    let text = ''
    if (!turnLive && currentTurn && currentUserMessageId) {
      const view = turns?.[currentUserMessageId]
      const failed =
        currentTurn.failed ||
        view?.phase === 'failed' ||
        failedTurnIdsRef.current.has(currentUserMessageId) ||
        currentTurn.messages.some(
          (m) =>
            m.messageType === 'error' && m.errorData?.errorCode !== 'agent.response_interrupted'
        )
      const ending = turnEnding(view, currentTurn.messages, failed)
      if (currentTurn.stopped) text = t('chatArea.status.stopped')
      else if (ending === 'failed') text = t('chatArea.status.failed')
      else if (ending === 'handed_off') text = t('chatArea.status.handedOff')
      else if (ending === 'refused') text = t('chatArea.status.refused')
      else if (!currentTurn.answerId) text = ''
      else if (currentTurn.gist)
        text = t('chatArea.status.answerReadyWith', { gist: currentTurn.gist })
      else text = t('chatArea.status.answerReady')
    }
    setTurnNote({ live: turnLive, text })
  }

  return { getStepsForUserMessage, answerHasBegun, heldAnswerId, renderedIdsRef, turnNote }
}
