'use client'

import type { JSX } from 'react'
import { Clock } from 'lucide-react'
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
}

export function InboxEntry({ item, current = false, onPick }: InboxEntryProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  const { title } = inboxItemCopy(item, t, namespaceRoot(collaborationCopy, locale), locale)
  const due = inboxDue(item, t, locale)
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
        'flex w-full min-w-0 items-start gap-2.5 rounded-control px-2.5 py-2 text-left outline-none transition-colors duration-snap motion-reduce:transition-none',
        'hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/50',
        current && 'bg-selected hover:bg-selected'
      )}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <InboxKindIcon item={item} className="text-muted-foreground size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-start gap-2">
          <span className={cn('text-foreground line-clamp-2 min-w-0 flex-1 text-sm leading-snug', !item.read && 'font-medium')} data-testid="inbox-entry-title">
            {item.excerpt ?? title}
          </span>
          {due && (
            <span
              className={cn(
                'text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs',
                due.variant === 'danger' && 'text-error font-medium',
                due.variant === 'warning' && 'text-warning font-medium'
              )}
              data-testid="inbox-entry-due"
            >
              <Clock className="size-3" aria-hidden />
              {due.label}
            </span>
          )}
        </span>
        {from && <span className="text-muted-foreground truncate text-xs">{from}</span>}
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          {item.projectName && (
            <>
              <span className="truncate" data-testid="inbox-entry-project">{item.projectName}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <time className="shrink-0 tabular-nums" dateTime={item.updatedAt}>
            {formatRelativeTime(item.updatedAt, locale)}
          </time>
        </span>
      </span>
    </button>
  )
}
