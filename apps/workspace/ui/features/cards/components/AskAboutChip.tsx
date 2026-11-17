'use client'

import { type FC } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'

const TRAILING_MARKS = new Set(['.', ',', ';', ':', '!', '?', '…'])

const stripTrailingMarks = (text: string): string => {
  let end = text.length
  while (end > 0 && TRAILING_MARKS.has(text[end - 1])) end -= 1
  return text.slice(0, end)
}

const tidy = (text: string | null | undefined, max: number): string => {
  const flat = stripTrailingMarks(
    (text ?? '')
      // eslint-disable-next-line no-control-regex -- control and bidi characters are what is removed
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ).trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const MAX_SUBJECT = 120
const MAX_MISSING = 240

const MIN_MEANINGFUL = 3

interface AskAboutChipProps {
  subject: string | null | undefined
  missing?: string | null
  className?: string
}

export const AskAboutChip: FC<AskAboutChipProps> = ({ subject, missing, className }) => {
  const t = useTranslations(chatCopy)
  const setComposerPrefill = useChatStore((s) => s.setComposerPrefill)

  const cleanSubject = tidy(subject, MAX_SUBJECT)
  const cleanMissing = tidy(missing, MAX_MISSING)

  if (cleanSubject.length < MIN_MEANINGFUL) return null

  const question =
    cleanMissing.length >= MIN_MEANINGFUL
      ? t('cards.askAbout.missingWithDetail', { subject: cleanSubject, missing: cleanMissing })
      : t('cards.askAbout.missingOnly', { subject: cleanSubject })

  return (
    <button
      type="button"
      aria-label={t('cards.askAbout.chipAria', { subject: cleanSubject })}
      title={question}
      onClick={() => setComposerPrefill(question)}
      className={cn(
        'group inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-full px-2',
        'bg-card text-muted-foreground shadow-xs text-[11px] font-medium',
        'transition-colors duration-quick ease-out motion-reduce:transition-none',
        'hover:bg-sheet-hover hover:text-foreground',
        'focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2',
        'pointer-coarse:h-11 pointer-coarse:px-3',
        className
      )}
    >
      <MessageCircleQuestion
        className="size-3 shrink-0 transition-colors duration-quick ease-out motion-reduce:transition-none"
        aria-hidden="true"
      />
      <span className="truncate">{t('cards.askAbout.chip')}</span>
    </button>
  )
}
