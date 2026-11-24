'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ArrowDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { namespaceRoot, useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { filesCopy } from '@/i18n/namespaces/files'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { inboxItemCopy } from '@/lib/inbox/item-copy'
import type { InboxItemView } from '@/lib/inbox/types'
import { Composer, type ComposerSend } from '@/features/documents'
import { withReviewBack } from '@/features/documents/review-links'
import { UploadReportLines } from '@/features/uploads'
import { MARK_CLIENT, replyOnMark, wakesAgent, type InboxMarkClient } from '../hooks/use-mark-answer'
import { useInboxMark, type InboxMarkLoad } from '../hooks/use-inbox-mark'
import { normNoticeOf } from '../lib/inbox-norm-notice'
import { inboxReason } from '../lib/inbox-reason'
import { InboxDueBadge } from './InboxEntry'
import { InboxMarkPlace, InboxMarkThread } from './InboxMarkPlace'
import { InboxNormActions, InboxNormLines } from './InboxNormNotice'
import { InboxReviewDecision } from './InboxReviewDecision'
import { documentLifecycleClient } from '@/lib/documents/lifecycle-client'

export interface InboxSameDocument {
  next: InboxItemView
  remaining: number
}

export interface InboxOpenedProps {
  item: InboxItemView
  viewerId?: string | null
  sameDocument?: InboxSameDocument | null
  onArchive: (itemId: string) => void
  onUnarchive: (itemId: string) => void
  onResolve: (item: InboxItemView) => void
  onAnswered: (item: InboxItemView) => void
  onPick: (item: InboxItemView) => void
  markClient?: InboxMarkClient
  loadMark?: InboxMarkLoad
}

export function InboxOpened({
  item,
  viewerId = null,
  sameDocument = null,
  onArchive,
  onUnarchive,
  onResolve,
  onAnswered,
  onPick,
  markClient = MARK_CLIENT,
  loadMark,
}: InboxOpenedProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const tFiles = useTranslations(filesCopy)
  const { locale } = useLocale()
  const pathname = usePathname()
  const query = useSearchParams()?.toString()
  const here = pathname ? `${pathname}${query ? `?${query}` : ''}` : null
  const { mark, loading, failed, replace } = useInboxMark(item, loadMark)
  const { title, body } = inboxItemCopy(item, t, namespaceRoot(collaborationCopy, locale), locale)
  const markEntry = loading || mark !== null || failed
  const open = item.actionable && item.state !== 'resolved' && item.state !== 'inert' && !item.archived
  const answerHere = open && item.answerIn === 'row' && mark !== null && mark.status === 'open'
  const answerInReview = open && item.answerIn === 'review'
  const canResolve = answerHere && item.type === 'annotation.assigned_to_you'
  const canDecideReview =
    item.type === 'document.review_requested' && open && item.resourceType === 'document' && item.anchorId !== null && item.subject !== null
  const normNotice = item.href ? normNoticeOf(item) : null
  const href = item.href ? (markEntry ? withReviewBack(item.href, here) : item.href) : null
  const headline = mark?.body ?? item.excerpt ?? title
  const said = inboxReason(item, t) ?? (headline !== title ? title : item.actorName)
  const place = [item.projectName ?? t('inbox.page.personal'), item.subject !== item.projectName ? item.subject : null]
    .filter(Boolean)
    .join(' · ')
  const showBody = body !== null && !answerHere && !answerInReview && !normNotice && !canDecideReview && body !== headline && body !== said
  const asksSomething = answerHere || canResolve || answerInReview || canDecideReview || normNotice !== null

  const send = async (text: string, how: ComposerSend) => {
    if (!mark) return
    const { annotation, kept, untold, wake } = await replyOnMark(markClient, mark.documentId, mark.id, text, how)
    replace(annotation)
    const sent = t(wake === 'off' ? 'inbox.mark.sentAgentNotAsked' : 'inbox.mark.sent')
    const notTold =
      untold.length === 0 ? null : untold.length === 1 ? tFiles('review.mentions.untoldOne', { name: untold[0] }) : tFiles('review.mentions.untoldMany', { names: untold.join(', ') })
    toast(sent, notTold ? { description: notTold } : undefined)
    onAnswered(item)
    return kept
  }

  return (
    <article className="flex h-full min-h-0 flex-col" data-testid="inbox-opened-entry" data-type={item.type}>
      <header className="flex flex-col gap-1.5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-muted-foreground min-w-0 truncate text-xs" data-testid="inbox-opened-place">
            {place}
          </p>
          <InboxDueBadge item={item} />
        </div>
        <h2 className="text-foreground whitespace-pre-line text-lg font-medium leading-snug" data-testid="inbox-opened-title">
          {headline}
        </h2>
        <p className="text-muted-foreground text-sm">
          {said && <span>{said} · </span>}
          <time dateTime={item.updatedAt} title={formatAbsoluteTime(item.updatedAt, locale)}>
            {formatRelativeTime(item.updatedAt, locale)}
          </time>
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4" data-testid="inbox-opened-body">
        {showBody && <p className="text-foreground text-sm leading-relaxed">{body}</p>}
        {loading && <Skeleton className="h-48 w-full rounded-surface" />}
        {failed && <p className="text-muted-foreground text-sm">{t('inbox.page.markFailed')}</p>}
        {mark && href && <InboxMarkPlace mark={mark} documentName={item.subject ?? ''} href={href} />}
        {mark && <InboxMarkThread mark={mark} viewerId={viewerId} />}
        {answerHere && mark && (
          <Composer
            key={mark.id}
            testId="inbox-opened-reply"
            placeholder={t('inbox.mark.replyLabel', { related: mark.number })}
            submitLabel={t('inbox.mark.send')}
            documentId={mark.documentId}
            mentionAgent={wakesAgent(item)}
            describeFailure={() => t('inbox.mark.failed')}
            onSubmit={send}
          />
        )}
        {normNotice && <InboxNormLines notice={normNotice} body={body} />}
        {normNotice && <InboxNormActions item={item} notice={normNotice} />}
        {canDecideReview && <InboxReviewDecision item={item} reviewClient={documentLifecycleClient} />}
        {item.uploadReport && item.state !== 'inert' && <UploadReportLines report={item.uploadReport} />}
      </div>

      <footer className="border-base flex flex-wrap items-center gap-2 border-t pt-4">
        {canResolve && (
          <Button size="sm" onClick={() => onResolve(item)} data-testid="inbox-opened-done">
            {t('inbox.page.done')}
          </Button>
        )}
        {href && (
          <Button asChild size="sm" variant={asksSomething ? 'secondary' : 'default'}>
            <Link href={href} data-testid="inbox-opened-go">
              {answerInReview ? t('inbox.mark.answerInReview') : markEntry ? t('inbox.page.review') : t('inbox.page.go')}
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          title={item.archived ? undefined : t('inbox.page.archiveKey')}
          onClick={() => (item.archived ? onUnarchive(item.id) : onArchive(item.id))}
          data-testid="inbox-opened-archive"
        >
          {item.archived ? t('inbox.unarchive') : t('inbox.archive')}
        </Button>
        {sameDocument && (
          <Button variant="ghost" size="sm" className="text-muted-foreground ms-auto" onClick={() => onPick(sameDocument.next)} data-testid="inbox-opened-next-here">
            {t('inbox.page.nextHere', { count: sameDocument.remaining })}
            <ArrowDown aria-hidden />
          </Button>
        )}
      </footer>
    </article>
  )
}

export function isSettledByAnswer(item: InboxItemView): boolean {
  return item.type === 'agent.asks_you' || item.type === 'annotation.mentioned'
}
