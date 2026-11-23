'use client'

import type { JSX } from 'react'
import * as React from 'react'

import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import type { ReplyToFeedbackResult } from '@/lib/product-feedback/client'
import type { OwnProductFeedbackMessage, OwnProductFeedbackThread } from '@/lib/product-feedback/types'
import { FeedbackCaseStatus, feedbackCaseState } from '../feedback-atoms'
import type { FeedbackThreadsApi, Load } from '../../lib/feedback-threads-api'
import { PaneHeader } from './pane-header'
import { ThreadMessages } from './thread-messages'

export const THREAD_POLL_MS = 20_000

const reporterMessages = (thread: OwnProductFeedbackThread): number =>
  thread.messages.filter((message) => message.author === 'reporter').length

interface Echo {
  message: OwnProductFeedbackMessage
  baseline: number
}

export function ThreadView({
  reportId,
  justSent,
  api,
  onBack,
  onNewFeedback,
}: {
  reportId: string
  justSent: boolean
  api: FeedbackThreadsApi
  onBack: () => void
  onNewFeedback: () => void
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const { locale } = useLocale()
  const [load, setLoad] = React.useState<Load<OwnProductFeedbackThread>>({ kind: 'loading' })
  const [echoes, setEchoes] = React.useState<Echo[]>([])

  const read = React.useCallback(
    async (quiet: boolean) => {
      if (!quiet) setLoad({ kind: 'loading' })
      try {
        setLoad({ kind: 'ready', value: await api.thread(reportId) })
      } catch {
        if (!quiet) setLoad({ kind: 'error' })
      }
    },
    [api, reportId],
  )

  React.useEffect(() => {
    void read(false)
    const timer = window.setInterval(() => void read(true), THREAD_POLL_MS)
    return () => window.clearInterval(timer)
  }, [read])

  const thread = load.kind === 'ready' ? load.value : null
  const held = thread ? reporterMessages(thread) : 0
  const pending = echoes.filter((echo) => echo.baseline >= held).map((echo) => echo.message)
  const messages = thread ? [...thread.messages, ...pending] : []
  const teamSpokeLast = messages.at(-1)?.author === 'team'

  const reply = async (message: string): Promise<ReplyToFeedbackResult> => {
    const before = thread ? reporterMessages(thread) : 0
    const result = await api.reply(reportId, message)
    if (!result.ok) return result
    setLoad({ kind: 'ready', value: result.thread })
    if (reporterMessages(result.thread) <= before) {
      const echo: OwnProductFeedbackMessage = {
        id: `pending-${Date.now()}`,
        author: 'reporter',
        authorName: null,
        content: message,
        createdAt: new Date().toISOString(),
      }
      setEchoes((current) => [...current, { message: echo, baseline: before }])
    }
    return result
  }

  return (
    <>
      <PaneHeader
        onBack={onBack}
        heading={
          <h2 className="truncate text-base leading-tight font-medium" data-testid="feedback-thread-title">
            {thread ? (
              <>
                {t(`kinds.${thread.report.kind}.label`)}
                {thread.report.ticketNumber !== null && (
                  <span className="text-muted-foreground font-normal tabular-nums">
                    {' · '}
                    {t('threads.ticketNumber', { number: thread.report.ticketNumber })}
                  </span>
                )}
              </>
            ) : (
              t('threads.title')
            )}
          </h2>
        }
        description={
          <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {thread ? (
              <>
                <FeedbackCaseStatus
                  state={feedbackCaseState(thread.live ? thread.report.status : null, thread.live && teamSpokeLast)}
                  mine={thread.report.mine}
                />
                {!thread.report.mine && thread.report.reporterName && <span>{thread.report.reporterName}</span>}
                {/* Without a status the chip already says „Gesendet": the time alone follows it. */}
                <span className="truncate">
                  {thread.report.status && <>{t('threads.updated')} </>}
                  <TimeAgo date={thread.report.status ? thread.report.lastActivityAt : thread.report.createdAt} locale={locale} />
                </span>
              </>
            ) : (
              <span aria-hidden>&nbsp;</span>
            )}
          </div>
        }
      />
      {load.kind === 'loading' && (
        <div className="flex flex-1 flex-col gap-3 p-6" aria-busy>
          <Skeleton className="h-16 w-3/4 self-end" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      )}
      {load.kind === 'error' && (
        <div className="p-6">
          <LoadError title={t('threads.threadLoadError')} onRetry={() => read(false)} />
        </div>
      )}
      {thread && (
        <ThreadMessages
          thread={thread}
          messages={messages}
          justSent={justSent}
          onNewFeedback={onNewFeedback}
          onReply={reply}
        />
      )}
    </>
  )
}
