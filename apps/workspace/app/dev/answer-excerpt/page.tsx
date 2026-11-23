'use client'

import { notFound, useSearchParams } from 'next/navigation'
import { type FC, type ReactNode, Suspense, useEffect } from 'react'
import { I18nProvider } from '@/i18n'
import { AgentResponse } from '@/features/chat/components/AgentResponse'
import { AnswerExcerptAsk } from '@/features/chat/components/AnswerExcerptAsk'
import { ComposerExcerptBar } from '@/features/chat/components/ComposerExcerptBar'
import { UserMessage } from '@/features/chat/components/UserMessage'
import { excerptFor } from '@/features/chat/lib/answer-excerpt'
import { useChatStore } from '@/features/chat/store'

const CONVERSATION = 'dev-answer-excerpt'
const at = new Date('2026-11-18T09:30:00')
const ANSWER = [
  'Für das Bürogebäude der Gebäudeklasse 4 gilt:',
  '',
  '- Die Fluchtweglänge darf 40 m bis zum nächsten Treppenhaus nicht überschreiten.',
  '- Das Treppenhaus braucht eine Rauchabzugseinrichtung an oberster Stelle.',
  '- Türen im Verlauf des Fluchtwegs schlagen in Fluchtrichtung auf.',
].join('\n')
const PART = 'Das Treppenhaus braucht eine Rauchabzugseinrichtung an oberster Stelle.'

const Block: FC<{ title: string; note: string; children: ReactNode }> = ({ title, note, children }) => (
  <section className="flex flex-col gap-3">
    <div>
      <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
    {children}
  </section>
)

function Preview() {
  const excerpt = useChatStore((state) => excerptFor(state.composerExcerpt, CONVERSATION))
  const setComposerExcerpt = useChatStore((state) => state.setComposerExcerpt)
  const selected = useSearchParams().get('variant') === 'selected'
  useEffect(() => {
    if (!selected) return
    const timer = window.setTimeout(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('[data-answer-excerpt-source]') && node.textContent?.includes(PART)) {
          const range = document.createRange()
          range.selectNodeContents(node)
          document.getSelection()?.removeAllRanges()
          document.getSelection()?.addRange(range)
          return
        }
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [selected])
  return (
    <main
      data-testid="answer-excerpt-preview"
      className="text-foreground mx-auto flex w-full max-w-[760px] flex-col gap-10 p-4 sm:p-6"
    >
      <Block
        title="Teil einer Antwort markieren"
        note="Text in der Antwort markieren: „Dazu fragen“ erscheint an der Markierung und legt den Teil über das Eingabefeld."
      >
        <AgentResponse content={ANSWER} messageId="dev-answer" timestamp={at} />
        <AnswerExcerptAsk conversationId={CONVERSATION} />
      </Block>
      <Block
        title="Über dem Eingabefeld"
        note="Der markierte Teil steht über dem Feld, bis die Nachricht gesendet oder er mit × entfernt wird."
      >
        <div className="bg-card rounded-xl border p-3 shadow-xs">
          <ComposerExcerptBar
            excerpt={excerpt ?? { conversationId: CONVERSATION, messageId: 'dev-answer', text: PART }}
            onClear={() => setComposerExcerpt(null)}
          />
          <div className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-[13px]">
            Woher kommt diese Anforderung?
          </div>
        </div>
      </Block>
      <Block title="In der gesendeten Nachricht" note="Die Nachricht zitiert den Teil, auf den sie sich bezieht.">
        <UserMessage content="Woher kommt diese Anforderung?" timestamp={at} answerExcerpt={excerpt?.text ?? PART} />
      </Block>
    </main>
  )
}

export default function AnswerExcerptPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    </I18nProvider>
  )
}
