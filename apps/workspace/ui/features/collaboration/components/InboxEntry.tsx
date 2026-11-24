'use client'

import type { JSX } from 'react'
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

export function InboxEntry({ item, current = false, onPick, className }: InboxEntryProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  const { title } = inboxItemCopy(item, t, namespaceRoot(collaborationCopy, locale), locale)
  const from = inboxReason(item, t) ?? [item.actorName, item.subject].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      aria-current={current ? 'true' : undefined}
      data-item-id={item.id}
      data-testid="inbox-entry"
      data-focus-inset=""
      className={cn(
        'flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left outline-none transition-colors duration-snap motion-reduce:transition-none',
        'hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50',
        current && 'bg-selected hover:bg-selected',
        className
      )}
    >
      <span className="bg-muted mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control">
        <InboxKindIcon item={item} className="text-foreground size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-start gap-2">
          <span className={cn('text-foreground line-clamp-2 min-w-0 flex-1 text-sm leading-snug', !item.read && 'font-medium')} data-testid="inbox-entry-title">
            {item.excerpt ?? title}
          </span>
          <InboxDueBadge item={item} />
        </span>
        {from && <span className="text-muted-foreground truncate text-xs">{from}</span>}
        <span className="flex min-w-0 items-center justify-between gap-2 text-xs">
          <span className="bg-muted text-foreground min-w-0 truncate rounded-sm px-1.5 py-0.5" data-testid="inbox-entry-project">
            {item.projectName ?? t('inbox.page.personal')}
          </span>
          <time className="text-muted-foreground shrink-0 tabular-nums" dateTime={item.updatedAt}>
            {formatRelativeTime(item.updatedAt, locale)}
          </time>
        </span>
      </span>
    </button>
  )
}
