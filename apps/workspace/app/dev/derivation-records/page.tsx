'use client'

/**
 * The Herleitung of stored building-law answers, read back the way a reload
 * reads them: the payload `conversation-message-list` returned on dev, mapped
 * by `mapServerMessageToChatMessage` and drawn by the real `ChatThinking`,
 * opened. The records a source carries (the work's designation, the edition's
 * label, the act that declares it binding) are what a person should read in
 * it, never a corpus file name. Not linked anywhere; 404s outside development.
 *
 * `?case=` picks the answer: `stairs` (default, two citations of one corpus
 * text plus the adopting act read live) or `u-value` (one corpus text cited
 * twice, two confidence findings).
 */

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { ChatThinking } from '@/features/chat/components/ChatThinking'
import { mapServerMessageToChatMessage } from '@/features/chat/lib/server-message-mapper'
import stairs from '@/test-utils/stored-answers/graz-stairs.json'
import uValue from '@/test-utils/stored-answers/wien-u-value.json'

const CASES = { stairs, 'u-value': uValue } as const

export default function DerivationRecordsPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const [name, setName] = useState<keyof typeof CASES | null>(null)
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('case')
    setName(asked === 'u-value' ? 'u-value' : 'stairs')
  }, [])
  if (!name) return null

  const stored = CASES[name]
  const answer = mapServerMessageToChatMessage(stored.answer)
  const question = mapServerMessageToChatMessage(stored.question)

  return (
    <main className="bg-background min-h-dvh px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <h1 className="text-muted-foreground font-mono text-xs" data-testid="derivation-records-preview">
          /dev/derivation-records?case={name}: a stored answer, read back
        </h1>
        <div className="w-[680px] max-w-full">
          <ChatThinking
            steps={question?.thinkingSteps ?? []}
            isThinking={false}
            autoOpen
            userQuestion={stored.question.content}
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
