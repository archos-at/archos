'use client'

import { type FC, type ReactNode } from 'react'
import { UserMessage } from '@/features/chat/components/UserMessage'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import { AgentResponse } from '@/features/chat/components/AgentResponse'
import { FollowUpsRail } from '@/features/chat/components/FollowUpsRail'
import type { CitationSource } from '@/features/chat/types'
import type { AnswerCard } from '@/shared/cards/schemas'
import type { MessageStages } from '@/lib/conversations/message-stages'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { AnswerMeta } from '@/lib/conversations/message-answer-meta'
import { citations } from './source-fixtures'
import { answer, commonThinking, question } from './turn-fixtures'

export function LiveTurn() {
  return (
    <div className="bg-background flex flex-col gap-5 rounded-2xl border p-5">
      <div className="text-muted-foreground font-mono text-xs">
        ↓ LIVE — thinking, Herleitung expanded, answer absent
      </div>
      <UserMessage content={question} timestamp={new Date('2024-01-15T14:30:00')} />
      <div className="w-[680px] max-w-full">
        <ChatThinking
          {...commonThinking}
          isThinking
          autoOpen
          answerConfidence="high"
          citations={citations}
        />
      </div>
    </div>
  )
}

export function CompletedTurn() {
  return (
    <div className="bg-background flex flex-col gap-5 rounded-2xl border p-5">
      <div className="text-muted-foreground font-mono text-xs">
        ↓ COMPLETED — Herleitung collapsed, answer dominant
      </div>
      <UserMessage content={question} timestamp={new Date('2024-01-15T14:30:00')} />
      <div className="w-[680px] max-w-full">
        <ChatThinking
          {...commonThinking}
          isThinking={false}
          autoOpen={false}
          answerConfidence="high"
          citations={citations}
        />
      </div>
      <AgentResponse
        content={answer}
        timestamp={new Date('2024-01-15T14:30:12')}
        answerDurationMs={12_400}
        citations={citations}
        answerConfidence="high"
        answerConfidenceReason="OIB-RL 2 direkt als Quelle belegt"
        routingDecision="shallow"
        messageId="msg-a1"
      />
    </div>
  )
}

export const AnswerTurn: FC<{
  label: string
  question: string
  answer: string
  cards?: AnswerCard[]
  citations: CitationSource[]
  confidenceReason: string
  messageId: string
  rail?: { question: string; hint?: string }[]
  stages?: MessageStages
  cardInteractions?: CardInteractions
  answerMeta?: AnswerMeta
  conversationId?: string
  isStreaming?: boolean
  children?: ReactNode
}> = ({
  label,
  question,
  answer,
  cards,
  citations,
  confidenceReason,
  messageId,
  rail,
  stages,
  cardInteractions,
  answerMeta,
  conversationId,
  isStreaming,
  children,
}) => (
  <div className="bg-background flex flex-col gap-5 rounded-2xl border p-5">
    <div className="text-muted-foreground font-mono text-xs">{label}</div>
    {children}
    <UserMessage content={question} timestamp={new Date('2024-01-15T14:30:00')} />
    <div className="w-[680px] max-w-full">
      <ChatThinking
        {...commonThinking}
        userQuestion={question}
        isThinking={false}
        autoOpen={false}
        answerConfidence="high"
        citations={citations}
      />
    </div>
    {/* `gap-4` — the message column's real gap in ChatArea, so the distance
        between the answer and the rail is the production one and not this
        preview panel's own rhythm. */}
    <div className="flex flex-col gap-4">
      <AgentResponse
        content={answer}
        timestamp={new Date('2024-01-15T14:30:12')}
        cards={cards}
        citations={citations}
        conversationId={conversationId}
        answerConfidence="high"
        answerConfidenceReason={confidenceReason}
        routingDecision="shallow"
        messageId={messageId}
        stages={stages}
        cardInteractions={cardInteractions}
        answerMeta={answerMeta}
        isStreaming={isStreaming}
      />
      {rail && (
        <div className="w-[680px] max-w-full">
          <FollowUpsRail items={rail} />
        </div>
      )}
    </div>
  </div>
)
