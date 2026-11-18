'use client'

import { useState, type JSX } from 'react'
import { X } from 'lucide-react'
import { AgentGlyph } from '@/components/ui/agent-glyph'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { filesCopy } from '@/i18n/namespaces/files'
import type { AnnotationView } from '@/lib/annotations/types'
import { liveLine } from '@/features/chat/lib/turn-events'
import { stepsOf, type CanvasAsk } from '../../../hooks/use-canvas-ask'
import type { DocumentReview } from '../../../hooks/use-document-review'
import { answerAsBody } from '../../../lib/agent-answer-text'

export function AgentThreadRow({ ask, review }: { ask: CanvasAsk; review: DocumentReview }): JSX.Element {
  const t = useTranslations(filesCopy)
  const tChat = useTranslations(chatCopy)
  const [adopting, setAdopting] = useState(false)
  const [adoptFailed, setAdoptFailed] = useState(false)
  const line = liveLine(stepsOf(ask.view), tChat) ?? t('review.piloti.replying')
  const close = (
    <button data-attr="files-dismiss"
      type="button"
      className="text-muted-foreground hover:text-foreground ml-auto shrink-0 self-start rounded p-0.5"
      aria-label={t('review.piloti.close')}
      onClick={() => review.piloti.dismiss(ask.id)}
    >
      <X className="size-3" aria-hidden />
    </button>
  )
  if (ask.status === 'answered' && ask.annotationId && ask.view?.text) {
    const annotationId = ask.annotationId
    const body = answerAsBody(ask.view.text)
    return (
      <div className="flex gap-2.5" data-testid="thread-agent-unposted" role="status">
        <AgentGlyph />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-muted-foreground text-[11px] leading-4">{t('review.piloti.degradedThread')}</p>
          <p className="text-foreground text-sm leading-5 break-words whitespace-pre-line">{body}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            disabled={adopting}
            onClick={async () => {
              setAdopting(true)
              setAdoptFailed(false)
              try {
                await review.reply(annotationId, body)
                review.piloti.dismiss(ask.id)
              } catch {
                setAdoptFailed(true)
              } finally {
                setAdopting(false)
              }
            }}
          >
            {t('review.piloti.adoptReply')}
          </Button>
          {adoptFailed && <FieldError>{t('review.actionFailed')}</FieldError>}
        </div>
        {close}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2.5" data-testid="thread-agent-pending" role="status">
      <AgentGlyph working={ask.status === 'thinking'} />
      {ask.status === 'thinking' ? (
        <ShimmerText className="min-w-0 flex-1 text-xs">{line}</ShimmerText>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('review.piloti.replyFailed')}</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => review.piloti.retry(ask.id)}>
            {t('review.piloti.retry')}
          </Button>
          {close}
        </span>
      )}
    </div>
  )
}

export function AgentWorkRow({ annotation }: { annotation: AnnotationView }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const work = annotation.pilotiWork
  if (!work) return null
  const delegated = work.trigger === 'assigned'
  if (delegated && (work.state === 'queued' || work.state === 'working')) return null
  const name = work.forName ?? t('review.someone')
  if (work.state === 'failed') {
    return (
      <div className="flex items-start gap-2.5" data-testid="thread-agent-work" data-state={work.state} role="status">
        <AgentGlyph />
        <span className="text-muted-foreground min-w-0 flex-1 text-xs leading-5">
          {t(`review.piloti.workFailed.${work.reasonKind ?? 'error'}`, { name })}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2.5" data-testid="thread-agent-work" data-state={work.state} role="status">
      <AgentGlyph working={work.state !== 'held'} />
      {work.state === 'held' ? (
        <span className="text-muted-foreground min-w-0 flex-1 text-xs">{t('review.piloti.wakeHeld')}</span>
      ) : (
        <ShimmerText className="min-w-0 flex-1 text-xs">
          {t(work.state === 'queued' ? 'review.piloti.workQueued' : 'review.piloti.replyingFor', { name })}
        </ShimmerText>
      )}
    </div>
  )
}
