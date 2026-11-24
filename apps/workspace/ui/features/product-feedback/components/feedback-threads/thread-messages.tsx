'use client'

import type { JSX } from 'react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { isCoarsePointer } from '@/components/ui/overlay-focus'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Composer } from '@/features/documents/components/review/composer'
import { UserMessage } from '@/features/chat/components/UserMessage'
import { useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import type { ReplyToFeedbackResult } from '@/lib/product-feedback/client'
import {
  PRODUCT_FEEDBACK_MESSAGE_MAX,
  type OwnProductFeedbackMessage,
  type OwnProductFeedbackThread,
} from '@/lib/product-feedback/types'
import { cn } from '@/lib/utils'
import { FIT_VIEWPORT } from '../feedback-form'

class ReplyNotSent extends Error {
  constructor(readonly reason: 'rate-limited' | 'failed') {
    super(reason)
  }
}

export function ThreadMessages({
  thread,
  messages,
  justSent,
  onReply,
  onNewFeedback,
}: {
  thread: OwnProductFeedbackThread
  messages: OwnProductFeedbackMessage[]
  justSent: boolean
  onReply: (message: string) => Promise<ReplyToFeedbackResult>
  onNewFeedback: () => void
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const answered = messages.some((message) => message.author === 'team')
  const mine = thread.report.mine
  const [focusComposer] = React.useState(() => !isCoarsePointer())

  React.useLayoutEffect(() => {
    const viewport = contentRef.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [messages.length])

  React.useEffect(() => {
    const viewport = contentRef.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport || typeof ResizeObserver === 'undefined') return
    let atEnd = true
    let height = viewport.clientHeight
    const onScroll = (): void => {
      if (viewport.clientHeight !== height) return
      atEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24
    }
    const observer = new ResizeObserver(() => {
      height = viewport.clientHeight
      if (atEnd) viewport.scrollTop = viewport.scrollHeight
    })
    viewport.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(viewport)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  const reporter = thread.report.reporterName ?? t('threads.unknownReporter')
  return (
    <>
      <ScrollArea className={cn('min-h-0 flex-1', FIT_VIEWPORT)}>
        <div ref={contentRef} className="flex flex-col gap-4 p-4" data-testid="feedback-thread-messages" data-chat-surface="feedback">
          {/* The chat's own attributed message: the header names who spoke
              (you, a colleague, or the team member). Unlike the agent's chat
              this is a two-party conversation, so the team speaks from the left. */}
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const sameSpeaker = previous?.author === message.author && previous.authorName === message.authorName
            return (
              <UserMessage
                key={message.id}
                content={message.content}
                timestamp={message.createdAt}
                grouped={sameSpeaker}
                side={message.author === 'team' ? 'start' : 'end'}
                author={
                  message.author === 'reporter'
                    ? mine
                      ? { isYou: true, userId: 'feedback-reporter' }
                      : { userId: 'feedback-reporter', name: reporter }
                    : {
                        userId: `piloti-team:${message.authorName ?? ''}`,
                        name: message.authorName ? t('threads.teamMember', { name: message.authorName }) : t('threads.team'),
                      }
                }
              />
            )
          })}
          {!thread.live && <ThreadNote>{t('threads.notLive')}</ThreadNote>}
          {/* A report sent from the form a moment ago: the thanks the dialog's
              success panel used to say, where the answer will arrive. */}
          {thread.live && !answered && (
            <ThreadNote testId={justSent ? 'feedback-sent' : undefined}>
              {justSent ? t('threads.sent') : t('threads.waiting')}
            </ThreadNote>
          )}
        </div>
      </ScrollArea>
      <div className="border-t px-4 pt-3 pb-[max(0.75rem,var(--overlay-inset-bottom,env(safe-area-inset-bottom)))]">
        {thread.report.canReply ? (
          <Composer
            testId="feedback-reply-input"
            placeholder={t('threads.replyPlaceholder')}
            submitLabel={t('threads.replySend')}
            maxLength={PRODUCT_FEEDBACK_MESSAGE_MAX}
            autoFocus={focusComposer}
            onSubmit={async (body) => {
              const result = await onReply(body.trim())
              if (!result.ok) throw new ReplyNotSent(result.reason)
            }}
            describeFailure={(error) =>
              error instanceof ReplyNotSent && error.reason === 'rate-limited'
                ? t('threads.replyRateLimited')
                : t('threads.replyError')
            }
          />
        ) : mine ? (
          <div className="flex flex-col items-start gap-3 px-2 py-1">
            <p className="text-muted-foreground text-sm text-pretty">{t('threads.cannotReply')}</p>
            <Button variant="secondary" size="sm" onClick={onNewFeedback}>
              {t('threads.send')}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground px-2 py-1 text-sm text-pretty" data-testid="feedback-thread-readonly">
            {thread.report.reporterName
              ? t('threads.readOnly', { name: thread.report.reporterName })
              : t('threads.readOnlyUnnamed')}
          </p>
        )}
      </div>
    </>
  )
}

function ThreadNote({ children, testId }: { children: string; testId?: string }): JSX.Element {
  return <p data-testid={testId} className="text-muted-foreground mx-auto max-w-xs py-2 text-center text-xs text-pretty">{children}</p>
}
