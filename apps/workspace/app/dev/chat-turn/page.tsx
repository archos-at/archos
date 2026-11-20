'use client'

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { CompletedTurn, LiveTurn } from './turn-previews'
import { AnswerLayer, isAnswerVariant } from './answer-layer'
import { FEEDBACK_STATES } from './answer-fixtures'

if (typeof window !== 'undefined') {
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/feedback/answers')) {
      const conversationId = new URL(url, 'http://x').searchParams.get('conversationId') ?? ''
      return new Response(JSON.stringify({ feedback: FEEDBACK_STATES[conversationId] ?? [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return real(input, init)
  }
}

export default function ChatTurnPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <ChatTurnPreview />
    </I18nProvider>
  )
}

function ChatTurnPreview() {
  const [variant, setVariant] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setVariant(new URLSearchParams(window.location.search).get('variant'))
  }, [])

  if (variant === undefined) return null

  const heading = isAnswerVariant(variant)
    ? `/dev/chat-turn?variant=${variant} — the answer layer inside a real turn`
    : '/dev/chat-turn — live (reasoning expanded) → completed (answer-dominant)'

  return (
    <main className="bg-muted/30 min-h-dvh px-4 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <h1
          className="text-muted-foreground font-mono text-xs"
          data-testid={isAnswerVariant(variant) ? 'answer-layer-preview' : 'chat-turn-preview'}
        >
          {heading}
        </h1>
        {isAnswerVariant(variant) ? (
          <AnswerLayer variant={variant} />
        ) : (
          <>
            <LiveTurn />
            <CompletedTurn />
          </>
        )}
      </div>
    </main>
  )
}
