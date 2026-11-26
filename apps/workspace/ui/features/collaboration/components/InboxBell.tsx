'use client'

import type { JSX } from 'react'
import { useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowRight, Bell } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import type { InboxItemView } from '@/lib/inbox/types'
import { cn } from '@/lib/utils'
import { useInboxBadge, useInboxList } from '../hooks/use-inbox'
import { isOverdue, newestFirstOverdueOnTop } from '../lib/inbox-entry-order'
import { isPlainClick } from '../lib/plain-click'
import { InboxBadge } from './InboxBadge'
import { InboxEntry } from './InboxEntry'

export const INBOX_HREF = '/app/inbox'
export const INBOX_GLANCE_LIMIT = 4

function Glance({ onLeave }: { onLeave: (href: string) => void }): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const list = useInboxList(true, 'requests')
  const waiting = newestFirstOverdueOnTop(list.items)
  const late = waiting.filter((item) => isOverdue(item)).length
  const open = (item: InboxItemView): void => onLeave(`${INBOX_HREF}?item=${encodeURIComponent(item.id)}`)
  return (
    <div className="flex flex-col" data-testid="inbox-glance">
      <p className="border-base flex items-baseline gap-2 border-b px-4 py-3">
        <span className="text-foreground text-base font-semibold">{t('inbox.queue.waiting')}</span>
        <span className="text-muted-foreground text-sm tabular-nums" data-testid="inbox-glance-count">{list.counts.requests}</span>
        {late > 0 && <span className="text-error text-sm">{t('inbox.bell.late', { count: late })}</span>}
      </p>
      {waiting.length === 0 && !list.loading ? (
        <p className="text-muted-foreground px-4 py-4 text-sm">{t('inbox.empty.needsMeDescription')}</p>
      ) : (
        <ul className="divide-base flex flex-col divide-y">
          {waiting.slice(0, INBOX_GLANCE_LIMIT).map((item) => (
            <li key={item.id}>
              <InboxEntry item={item} onPick={open} />
            </li>
          ))}
        </ul>
      )}
      <div className="border-base flex items-center justify-between gap-2 border-t px-4 py-3">
        <span className="text-muted-foreground text-xs" data-testid="inbox-glance-news">
          {t('inbox.bell.news', { count: list.counts.unread })}
        </span>
        <Link href={INBOX_HREF} onClick={() => onLeave(INBOX_HREF)} className="text-foreground inline-flex items-center gap-1.5 text-sm font-medium hover:underline" data-testid="inbox-glance-open">
          {t('inbox.bell.open')}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

export interface InboxBellProps {
  compact?: boolean
  tourAnchor?: string
  pathname?: string
  className?: string
}

export function InboxBell({ compact = false, tourAnchor, pathname: pathnameOverride, className }: InboxBellProps): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const router = useRouter()
  const routerPathname = usePathname()
  const pathname = pathnameOverride ?? routerPathname ?? ''
  const here = pathname === INBOX_HREF || pathname.startsWith(`${INBOX_HREF}/`)
  const { pending } = useInboxBadge(true)
  const [open, setOpen] = useState(false)

  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!isPlainClick(event)) return
    event.preventDefault()
    if (here) {
      if (window.history.length > 1) router.back()
      else router.push('/app')
      return
    }
    setOpen((was) => !was)
  }

  return (
    <Popover open={open && !here} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Link
          href={INBOX_HREF}
          onClick={onClick}
          aria-label={here ? t('inbox.bell.back') : pending > 0 ? t('inbox.badgeAria', { count: pending }) : t('inbox.navLabel')}
          aria-current={here ? 'page' : undefined}
          aria-expanded={here ? undefined : open}
          title={here ? t('inbox.bell.back') : t('inbox.navLabel')}
          data-testid="inbox-bell"
          data-tour={tourAnchor}
          className={cn(
            'border-base text-foreground flex shrink-0 items-center justify-center gap-1.5 rounded-control border transition-colors duration-quick ease-out motion-reduce:transition-none',
            compact ? 'size-8 flex-col gap-0 border-transparent pointer-coarse:size-11' : 'h-8 min-w-8 px-2 pointer-coarse:h-11',
            'hover:bg-desk in-data-[sidebar=sidebar]:hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            (here || open) && 'bg-sheet hover:bg-sheet in-data-[sidebar=sidebar]:hover:bg-sheet',
            className
          )}
        >
          <Bell className="size-4 shrink-0" aria-hidden />
          <InboxBadge pending={pending} />
        </Link>
      </PopoverAnchor>
      <PopoverContent side={compact ? 'right' : 'top'} align="end" sideOffset={14} className="w-[25rem] overflow-hidden p-0">
        {open && !here && (
          <Glance
            onLeave={(href) => {
              setOpen(false)
              router.push(href)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
