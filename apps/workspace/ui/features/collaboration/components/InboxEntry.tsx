'use client'

import type { JSX } from 'react'
import { AttentionDot } from '@/components/ui/attention-dot'
import { Badge } from '@/components/ui/badge'
import { namespaceRoot, useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { formatRelativeTime } from '@/lib/format'
import { inboxItemCopy } from '@/lib/inbox/item-copy'
import type { InboxItemView } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import { inboxDue } from '../lib/inbox-due'
import { inboxReason } from '../lib/inbox-reason'
import { InboxKindIcon } from './InboxItemFace'

export interface InboxEntryProps {
  item: InboxItemView
  current?: boolean
  onPick: (item: InboxItemView) => void
  className?: string
}

export function InboxDueBadge({ item }: { item: InboxItemView }): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  const due = inboxDue(item, t, locale)
  if (!due) return null
  return (
    <Badge variant={due.variant} className="shrink-0" data-testid="inbox-entry-due">
      {due.label}
    </Badge>
  )
}

export function inboxEntryPlace(item: InboxItemView, personal: string, shown: string): string {
  const subject = item.subject && item.subject !== item.projectName && !shown.includes(item.subject) ? item.subject : null
  return [item.projectName ?? personal, subject].filter(Boolean).join(' · ')
}

export function InboxEntry({ item, current = false, onPick, className }: InboxEntryProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  const { title } = inboxItemCopy(item, t, namespaceRoot(collaborationCopy, locale), locale)
  const shown = item.excerpt ?? title
  const from = inboxReason(item, t) ?? (item.excerpt ? title : item.actorName)
  const place = inboxEntryPlace(item, t('inbox.page.personal'), shown)
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      aria-current={current ? 'true' : undefined}
      data-item-id={item.id}
      data-testid="inbox-entry"
      data-focus-inset=""
      className={cn(
        'relative flex w-full min-w-0 items-start gap-3 py-3 pl-6 pr-4 text-left outline-none transition-colors duration-snap motion-reduce:transition-none',
        'hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50',
        current && 'bg-selected hover:bg-selected',
        className
      )}
    >
      <AttentionDot show={!item.read} className="absolute left-2 top-[1.15rem] size-1.5 ring-0" />
      <InboxKindIcon item={item} className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-start gap-2">
          <span className={cn('text-foreground line-clamp-2 min-w-0 flex-1 text-sm leading-snug', !item.read && 'font-medium')} data-testid="inbox-entry-title">
            {shown}
          </span>
          <InboxDueBadge item={item} />
        </span>
        {from && <span className="text-muted-foreground truncate text-xs" data-testid="inbox-entry-from">{from}</span>}
        <span className="text-muted-foreground flex min-w-0 items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate" data-testid="inbox-entry-project">
            {place}
          </span>
          <time className="shrink-0 tabular-nums" dateTime={item.updatedAt}>
            {formatRelativeTime(item.updatedAt, locale)}
          </time>
        </span>
      </span>
    </button>
  )
}
