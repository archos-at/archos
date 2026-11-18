'use client'

import { type FC, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { AnimatePresence, motion, useIconSwapTransition } from '@/components/motion'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import { formatTime } from '@/shared/utils/format-time'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { MentionText } from '@/features/collaboration/components/MentionText'
import { MessageAuthor } from './MessageAuthor'

const COPY_BUTTON_CLASS = cn(
  'absolute right-2 top-2 rounded-control bg-muted p-1.5 text-muted-foreground',
  'opacity-0 transition-[opacity,color,background-color,scale] [transition-duration:var(--motion-quick),var(--motion-quick),var(--motion-quick),var(--motion-snap)] ease-out group-hover:opacity-100 active:scale-[0.98] motion-reduce:active:scale-100',
  'focus-visible:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none',
  'inline-flex items-center justify-center pointer-coarse:size-11 pointer-coarse:bg-transparent pointer-coarse:p-0',
  'hover:bg-selected hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
)

export interface UserMessageAuthor {
  userId?: string | null
  name?: string | null
  avatarUrl?: string | null
  isYou?: boolean
}

export interface UserMessageProps {
  content: string
  timestamp?: Date | string
  author?: UserMessageAuthor
  grouped?: boolean
  mentions?: Array<{ targetId: string; display: string }>
  currentUserId?: string | null
  side?: 'end' | 'start'
}

export const UserMessage: FC<UserMessageProps> = ({
  content,
  timestamp,
  author,
  grouped = false,
  mentions,
  currentUserId,
  side,
}) => {
  const t = useTranslations(chatCopy)
  const swap = useIconSwapTransition()
  const [copied, setCopied] = useState(false)
  const { locale } = useLocale()

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('copyMessage.failed'))
    }
  }

  const body =
    mentions && mentions.length > 0 ? (
      <MentionText content={content} mentions={mentions} currentUserId={currentUserId} />
    ) : (
      <MarkdownRenderer content={content} compact />
    )

  if (!author) {
    return (
      <div className="flex w-full flex-col items-end">
        {/* Bubble — width 400, asymmetric corners, hairline border, trace shadow */}
        {/* Three corners are the token radius; the 4px top-right is the
            bubble's tail-side notch — the one deliberate value, and what makes
            an input bubble identifiable at a glance. */}
        <div className="group relative w-[400px] max-w-full rounded-bubble rounded-tr-[4px] bg-card px-[14px] py-[11px] text-sm leading-[1.55] text-default shadow-xs pointer-coarse:pr-14">
          {/* No visible "Eingabe" tab: the bubble's side and notch already say
              it on screen (Notion #38, topic 9). A screen reader has neither,
              so it still hears whose turn this is. */}
          <span className="sr-only">{t('roles.input')}</span>
          {body}
          <button data-attr="chat-copy-message"
            type="button"
            onClick={() => void handleCopyMessage()}
            aria-label={copied ? t('copyMessage.copied') : t('copyMessage.copy')}
            className={COPY_BUTTON_CLASS}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={copied ? 'check' : 'copy'}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1, transition: swap.enter }}
                exit={{ opacity: 0, scale: 0.6, transition: swap.exit }}
                className="inline-flex"
                aria-hidden="true"
              >
                {copied ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>

        {timestamp && (
          <span className="text-subtle mr-[14px] mt-1 text-xs">{formatTime(timestamp, locale)}</span>
        )}
      </div>
    )
  }

  const isYou = author.isYou === true
  const start = side === 'start'
  const twoParty = side !== undefined

  return (
    <div
      className={cn(
        'flex w-full flex-col',
        start ? 'items-start' : 'items-end',
        grouped ? '-mt-2' : 'mt-1'
      )}
      data-shared-author={author.userId ?? 'unknown'}
      data-side={side ?? 'end'}
    >
      <MessageAuthor
        userId={author.userId}
        name={author.name}
        avatarUrl={author.avatarUrl}
        isYou={isYou}
        timestamp={timestamp}
        grouped={grouped}
        side={side ?? 'end'}
        className="mb-1.5"
      />

      <div
        className={cn(
          'group relative w-[400px] max-w-full rounded-bubble',
          'px-[14px] py-[11px] text-sm leading-[1.55] text-default shadow-xs',
          start ? 'rounded-tl-[4px] bg-muted' : 'rounded-tr-[4px] bg-card',
          twoParty && 'max-w-[85%]',
          start ? 'pointer-coarse:pl-14' : 'pointer-coarse:pr-14',
          grouped ? (start ? 'rounded-tl-lg' : 'rounded-tr-lg') : ''
        )}
      >
        {body}
        <button data-attr="chat-copy-message"
          type="button"
          onClick={() => void handleCopyMessage()}
          aria-label={copied ? t('copyMessage.copied') : t('copyMessage.copy')}
          className={start ? cn(COPY_BUTTON_CLASS, 'right-auto left-2') : COPY_BUTTON_CLASS}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={copied ? 'check' : 'copy'}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1, transition: swap.enter }}
              exit={{ opacity: 0, scale: 0.6, transition: swap.exit }}
              className="inline-flex"
              aria-hidden="true"
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>

      {/* The header carries the time; a grouped follow-up has no header, so it
          keeps the timestamp under the bubble as an unattributed message does. */}
      {grouped && timestamp && (
        <span className={cn('text-subtle mt-1 text-xs', start ? 'ml-[14px]' : 'mr-[14px]')}>
          {formatTime(timestamp, locale)}
        </span>
      )}
    </div>
  )
}
