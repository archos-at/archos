'use client'

import type { JSX } from 'react'
import { TextQuote, X } from 'lucide-react'
import { AnimatePresence } from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { ComposerExcerpt } from '../composer-types'

export function ComposerExcerptBar({
  excerpt,
  onClear,
}: {
  excerpt: ComposerExcerpt | null
  onClear: () => void
}): JSX.Element {
  const t = useTranslations(chatCopy)
  return (
    <AnimatePresence initial={false}>
      {excerpt && (
        <HeightArrival key="answer-excerpt" testId="composer-answer-excerpt">
          <div className="bg-muted/50 mb-2 flex items-start gap-2 rounded-control border px-2.5 py-2">
            <TextQuote className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-xs leading-snug">
              <span className="text-muted-foreground block">{t('answerExcerpt.askingAbout')}</span>
              <span className="line-clamp-3 break-words whitespace-pre-line">{excerpt.text}</span>
            </p>
            <button
              data-attr="chat-answer-excerpt-clear"
              type="button"
              onClick={onClear}
              aria-label={t('answerExcerpt.clear')}
              className="focus-visible:ring-ring/60 text-muted-foreground hover:text-foreground duration-quick pointer-coarse:inline-flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center pointer-coarse:p-0 shrink-0 rounded-control p-1 transition-colors ease-out focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </HeightArrival>
      )}
    </AnimatePresence>
  )
}
