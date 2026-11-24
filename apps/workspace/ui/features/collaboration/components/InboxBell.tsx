'use client'

import type { JSX } from 'react'
import { useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
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
    <div className="flex flex-col gap-2" data-testid="inbox-glance">
      <p className="text-foreground px-2.5 pt-1 text-sm font-medium">
        {t('inbox.bell.waiting', { count: list.counts.requests })}
        {late > 0 && <span className="text-error font-medium"> · {t('inbox.bell.late', { count: late })}</span>}
      </p>
      {waiting.length === 0 && !list.loading ? (
        <p className="text-muted-foreground px-2.5 pb-1 text-sm">{t('inbox.empty.needsMeDescription')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {waiting.slice(0, INBOX_GLANCE_LIMIT).map((item) => (
            <li key={item.id}>
              <InboxEntry item={item} onPick={open} />
            </li>
          ))}
        </ul>
      )}
      <div className="border-base flex items-center justify-between gap-2 border-t px-2.5 pt-2">
        <span className="text-muted-foreground text-xs" data-testid="inbox-glance-news">
          {t('inbox.bell.news', { count: list.counts.unread })}
        </span>
        <Link href={INBOX_HREF} onClick={() => onLeave(INBOX_HREF)} className="text-foreground text-sm font-medium hover:underline" data-testid="inbox-glance-open">
          {t('inbox.bell.open')}
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
      else router.push('/app/projects')
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
            'text-muted-foreground hover:text-foreground relative flex size-8 shrink-0 items-center justify-center rounded-control transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:size-11',
            'hover:bg-desk in-data-[sidebar=sidebar]:hover:bg-selected focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            (here || open) && 'bg-sheet text-foreground shadow-xs hover:bg-sheet in-data-[sidebar=sidebar]:hover:bg-sheet',
            className
          )}
        >
          <Bell className="size-4" aria-hidden />
          <InboxBadge pending={pending} className={cn('absolute', '-right-2 -top-2')} />
        </Link>
      </PopoverAnchor>
      <PopoverContent side={compact ? 'right' : 'top'} align="end" sideOffset={8} className="w-[22rem] p-2">
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
