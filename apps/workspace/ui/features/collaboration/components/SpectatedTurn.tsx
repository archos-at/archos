'use client'

import { type FC, useMemo, useState } from 'react'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import { AgentResponse } from '@/features/chat/components/AgentResponse'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { cn } from '@/lib/utils'
import type { TurnView } from '@/lib/turns/turn-fold'
import { citationsFromWireList } from '@/features/chat/lib/wire-citation'
import { sanitizeAnswerMeta } from '@/lib/conversations/message-answer-meta'
import { observerCards, orderedSteps } from '../lib/spectator-frames'

export interface SpectatedTurnProps {
  turn: TurnView
  label: string
  since?: Date | string | number
  className?: string
}

const useJoinedMidText = (turn: TurnView): string | null => {
  const [seen, setSeen] = useState<{ turnId: string; fragment: string | null; sawEmpty: boolean }>(() => ({
    turnId: turn.turnId,
    fragment: turn.messageId === undefined && turn.text ? turn.text : null,
    sawEmpty: !turn.text,
  }))
  if (seen.turnId !== turn.turnId) {
    setSeen({
      turnId: turn.turnId,
      fragment: turn.messageId === undefined && turn.text ? turn.text : null,
      sawEmpty: !turn.text,
    })
    return null
  }
  const fragment = seen.fragment
  if (fragment !== null && (turn.phase !== 'running' || !turn.text.startsWith(fragment))) {
    setSeen({ ...seen, fragment: null })
    return null
  }
  return fragment
}

export const SpectatedTurn: FC<SpectatedTurnProps> = ({ turn, label, since, className }) => {
  const t = useTranslations(collaborationCopy)
  const done = turn.phase !== 'running'
  const waitingOn = turn.interaction?.text
  const cards = useMemo(() => observerCards(turn), [turn.cards]) // eslint-disable-line react-hooks/exhaustive-deps
  const answerMeta = useMemo(() => sanitizeAnswerMeta(turn.answerMeta) ?? undefined, [turn.answerMeta])
  const citations = useMemo(() => citationsFromWireList(turn.sources), [turn.sources])
  const heldFragment = useJoinedMidText(turn)
  const text = heldFragment !== null ? '' : turn.text
  const hasSteps = turn.stepOrder.length > 0

  return (
    <div
      className={cn('flex w-full flex-col gap-2', className)}
      data-testid="spectated-turn"
      role="status"
      aria-live="off"
    >
      <div className="flex items-center gap-2">
        {/* The shimmer says "still working". It stops the moment the terminal
            frame lands, so the last second before the persisted answer swaps in
            does not look like a stall. And only while there is no Herleitung:
            its header carries the turn's one ambient loop, as it does for the
            asker, and two shimmers stacked were two. */}
        <ShimmerText active={!done && !hasSteps} className="text-foreground text-xs font-medium">
          {label}
        </ShimmerText>
      </div>

      {/* The reasoning chain, in the same panel the asker gets. Collapsed by
      default: an observer opting in to the detail is a click, an observer having
      it forced on them is noise in someone else's conversation. */}
      {hasSteps && (
        <ChatThinking
          steps={orderedSteps(turn)}
          isThinking={!done}
          isWaiting={Boolean(waitingOn)}
          answering={Boolean(text || answerMeta)}
          since={since}
        />
      )}

      {/* Piloti put a question to the asker. Stated, not offered. */}
      {waitingOn && (
        <p className="text-muted-foreground bg-muted rounded-lg px-3 py-2 text-xs">
          {t('thread.spectatorPrompt', { question: waitingOn })}
        </p>
      )}

      {turn.phase === 'failed' && (
        <p className="text-muted-foreground text-xs">{t('thread.spectatorFailed')}</p>
      )}

      {(text || answerMeta || cards?.some((card) => card !== undefined)) && (
        <AgentResponse
          content={text}
          isStreaming={!done}
          answerMeta={answerMeta}
          citations={citations}
          cards={cards}
          readOnly
        />
      )}
    </div>
  )
}
