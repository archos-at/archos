'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { ArchiveRestore, ChevronDown, X, type LucideIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { useLocale, useTranslations } from '@/i18n'
import type { InboundMailPartView } from '@/lib/inbound-mail/inbound-mail-wire'
import { formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { QuietPanel } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface Notice {
  key: string
  icon: LucideIcon
  iconClass: string
  title: string
  text?: string
  testId: string
  danger?: boolean
  onHide?: () => void
}

/** One notice stands whole; two or more fold into one line that opens on a tap, so they never push the mail off a phone. */
export function DetailNotices({ notices }: { notices: Notice[] }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const [open, setOpen] = useState(false)
  if (notices.length === 0) return null
  if (notices.length === 1 || open) {
    return (
      <div className="flex flex-col gap-2" data-testid="detail-notices" data-folded="false">
        {notices.map((notice) => (
          <NoticeAlert key={notice.key} notice={notice} />
        ))}
        {notices.length > 1 && (
          <Button type="button" variant="inline" className="text-muted-foreground touch-target h-auto self-start p-0 text-xs" aria-expanded onClick={() => setOpen(false)} data-testid="detail-notices-fold">
            {t('notices.fold')}
            <ChevronDown className="size-3.5 rotate-180" aria-hidden />
          </Button>
        )}
      </div>
    )
  }
  const [first] = notices
  const Icon = first.icon
  return (
    <div data-testid="detail-notices" data-folded="true">
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="bg-card hover:bg-sheet-hover flex min-h-10 w-full items-center gap-2.5 rounded-surface border px-3 py-2 text-left text-sm outline-none transition-colors duration-quick ease-out focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none pointer-coarse:min-h-11"
        data-testid="detail-notices-unfold"
      >
        <Icon className={cn('size-4 shrink-0', first.iconClass)} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium" data-testid={`${first.testId}-line`}>
          {first.title}
        </span>
        <span className="text-muted-foreground inline-flex shrink-0 items-center gap-0.5 text-xs">
          {t('notices.more', { count: notices.length - 1 })}
          <ChevronDown className="size-3.5" aria-hidden />
        </span>
      </button>
    </div>
  )
}

/** What became of a mail nothing of which waits any more, and the way back: „1 Teil verworfen · wiederherstellbar bis …“. */
export function RestorablePanel({ parts, restoring, onRestore }: { parts: readonly InboundMailPartView[]; restoring: boolean; onRestore: () => void }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const ended = parts.filter((part) => part.state === 'dismissed' || part.state === 'expired')
  const until = parts.map((part) => part.restorableUntil).find((date): date is string => !!date)
  if (ended.length === 0 || !until) return null
  const expired = ended.some((part) => part.state === 'expired')
  const date = formatCalendarDate(until, locale)
  return (
    <QuietPanel className="sm:flex-row sm:items-center sm:justify-between" data-testid="detail-restorable">
      <p className="text-sm">
        {/* A mail of which something was filed was not thrown away: say how many parts were, not „Verworfen“. */}
        {parts.some((part) => part.state === 'filed')
          ? t(expired ? 'state.partsExpired' : 'state.partsDismissed', { count: ended.length, date })
          : t(expired ? 'state.expired' : 'state.dismissed', { date })}
      </p>
      <BusyButton
        type="button"
        size="sm"
        variant="secondary"
        busy={restoring}
        busyLabel={t('state.restoreBusy')}
        icon={<ArchiveRestore aria-hidden />}
        onClick={onRestore}
        data-testid="detail-restore"
      >
        {t('state.restore')}
      </BusyButton>
    </QuietPanel>
  )
}

function NoticeAlert({ notice }: { notice: Notice }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const Icon = notice.icon
  return (
    <Alert variant={notice.danger ? 'destructive' : 'default'} data-testid={notice.testId}>
      <Icon aria-hidden className={notice.iconClass} />
      <AlertTitle className="line-clamp-none">{notice.title}</AlertTitle>
      {(notice.text || notice.onHide) && (
        <AlertDescription className="flex items-center justify-between gap-2">
          {notice.text && <span>{notice.text}</span>}
          {notice.onHide && (
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t('closed.dismiss')} onClick={notice.onHide}>
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </AlertDescription>
      )}
    </Alert>
  )
}
