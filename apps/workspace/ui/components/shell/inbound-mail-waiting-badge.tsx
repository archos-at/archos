'use client'

/**
 * The muted count on Dateien in the rail and the phone's tab bar: mails
 * waiting in the project's E-Mail-Eingang for this reader.
 *
 * Muted, as the Postfach's count is in the shell's chrome (`InboxBadge`,
 * `tone="muted"`): a quiet number beside a place, the `CountPill` muted tone,
 * white on the rail's grey band. Nothing at zero; the
 * real count is in the label, the pill caps at 99+.
 */

import type { JSX } from 'react'
import { CountPill } from '@/components/ui/count-pill'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'

export function InboundMailWaitingBadge({ count, className }: { count: number | null; className?: string }): JSX.Element | null {
  const t = useTranslations(navCopy)
  if (count === null || !Number.isFinite(count) || count <= 0) return null
  return (
    <CountPill
      tone="muted"
      role="status"
      aria-label={t('inboundMailWaiting', { count })}
      // A bare number beside „Dateien“ says nothing about mail to a sighted reader: the pointer's hover says it.
      title={t('inboundMailWaiting', { count })}
      data-testid="inbound-mail-badge"
      data-waiting={count}
      className={cn('in-data-[surface=sunken]:bg-on-sunken', className)}
      count={count}
    />
  )
}
