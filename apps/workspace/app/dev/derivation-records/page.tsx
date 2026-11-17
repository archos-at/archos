'use client'

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import {
  mapServerMessageToChatMessage,
  type ServerMessageInput,
} from '@/features/chat/lib/server-message-mapper'
import stairs from '@/test-utils/stored-answers/graz-stairs.json'
import uValue from '@/test-utils/stored-answers/wien-u-value.json'

interface StoredTurn {
  label: string
  question: ServerMessageInput
  answer: ServerMessageInput
}

const CASES: Record<string, StoredTurn> = {
  stairs: { label: 'case=stairs', ...stairs },
  'u-value': { label: 'case=u-value', ...uValue },
}

const turnOf = (id: string, listed: { messages?: ServerMessageInput[] }): StoredTurn | null => {
  const messages = listed.messages ?? []
  const answerAt = messages.findLastIndex((message) => message.role === 'assistant')
  const question = messages.slice(0, answerAt).findLast((message) => message.role === 'user')
  return answerAt >= 0 && question ? { label: `id=${id}`, question, answer: messages[answerAt] } : null
}

export default function DerivationRecordsPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const [turn, setTurn] = useState<StoredTurn | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (!id || !/^s_[0-9a-f_]+$/.test(id)) {
      setTurn(CASES[params.get('case') ?? ''] ?? CASES.stairs)
      return
    }
    void fetch(`/dev-stored-answers/${id}.json`)
      .then((response) => response.json())
      .then((listed) => setTurn(turnOf(id, listed)))
  }, [])
  if (!turn) return null

  const answer = mapServerMessageToChatMessage(turn.answer)
  const question = mapServerMessageToChatMessage(turn.question)

  return (
    <main className="bg-background min-h-dvh px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <h1 className="text-muted-foreground font-mono text-xs" data-testid="derivation-records-preview">
          /dev/derivation-records?{turn.label}: a stored answer, read back
        </h1>
        <div className="w-[680px] max-w-full">
          <ChatThinking
            steps={question?.thinkingSteps ?? []}
            isThinking={false}
            autoOpen
            userQuestion={turn.question.content}
            answerConfidence={answer?.answerConfidence}
            citations={answer?.citations}
            answerId={answer?.id}
            retrievalLedger={answer?.retrievalLedger}
          />
        </div>
      </div>
    </main>
  )
}
