'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { namespaceRoot, useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { formatRelativeTime } from '@/lib/format'
import { inboxItemCopy } from '@/lib/inbox/item-copy'
import { isMarkAnchored, type InboxItemView } from '@/lib/inbox/types'
import { withReviewBack } from '@/features/documents/lib/open-review'
import { useMarkAnswer } from '../hooks/use-mark-answer'
import { inboxReason } from '../lib/inbox-reason'
import { InboxDueBadge } from './InboxEntry'
import { InboxItemRow } from './InboxItemRow'

export interface InboxOpenedProps {
  item: InboxItemView
  viewerId?: string | null
  onArchive: (itemId: string) => void
  onUnarchive: (itemId: string) => void
  onMarkRead: (itemId: string) => void
  onMarkUnread: (itemId: string) => void
}

export function InboxOpened({ item, viewerId = null, onArchive, onUnarchive, onMarkRead, onMarkUnread }: InboxOpenedProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  const pathname = usePathname()
  const query = useSearchParams()?.toString()
  const here = pathname ? `${pathname}${query ? `?${query}` : ''}` : null
  const markRow = isMarkAnchored(item.type)
  const { canResolveMark, resolveMark, markBusy, markOutcome } = useMarkAnswer({ item, markRow })
  const { title } = inboxItemCopy(item, t, namespaceRoot(collaborationCopy, locale), locale)
  const place = [item.projectName ?? t('inbox.page.personal'), item.subject].filter(Boolean).join(' · ')
  const reason = inboxReason(item, t)
  const href = item.href ? (markRow ? withReviewBack(item.href, here) : item.href) : null
  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="inbox-opened-entry">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-muted-foreground min-w-0 truncate text-xs" data-testid="inbox-opened-place">{place}</p>
          <InboxDueBadge item={item} />
        </div>
        <h2 className="text-foreground text-lg font-medium leading-snug">{item.excerpt ?? title}</h2>
        <p className="text-muted-foreground text-sm">
          {[reason, formatRelativeTime(item.updatedAt, locale)].filter(Boolean).join(' · ')}
        </p>
      </header>
      <div className="border-base bg-card min-h-0 flex-1 overflow-y-auto rounded-surface border p-3">
        <ul>
          <InboxItemRow item={item} viewerId={viewerId} onArchive={onArchive} onUnarchive={onUnarchive} onMarkRead={onMarkRead} onMarkUnread={onMarkUnread} />
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canResolveMark && markOutcome !== 'resolved' && (
          <Button size="sm" disabled={markBusy} onClick={resolveMark} data-testid="inbox-opened-done">
            {t('inbox.page.done')}
          </Button>
        )}
        {href && (
          <Button asChild variant="secondary" size="sm">
            <Link href={href} data-testid="inbox-opened-go">
              {markRow ? t('inbox.page.review') : t('inbox.page.go')}
            </Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => (item.archived ? onUnarchive(item.id) : onArchive(item.id))} data-testid="inbox-opened-archive">
          {item.archived ? t('inbox.unarchive') : t('inbox.archive')}
        </Button>
      </div>
    </div>
  )
}
