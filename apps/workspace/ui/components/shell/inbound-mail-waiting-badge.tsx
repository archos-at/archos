'use client'

import type { JSX } from 'react'
import { CountPill } from '@/components/ui/count-pill'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { SHELL_COUNT } from './shell-count'
import { cn } from '@/lib/utils'

export function InboundMailWaitingBadge({ count, className }: { count: number | null; className?: string }): JSX.Element | null {
  const t = useTranslations(navCopy)
  if (count === null || !Number.isFinite(count) || count <= 0) return null
  return (
    <CountPill
      tone="muted"
      role="status"
      aria-label={t('inboundMailWaiting', { count })}
      title={t('inboundMailWaiting', { count })}
      data-testid="inbound-mail-badge"
      data-waiting={count}
      className={cn(SHELL_COUNT, className)}
      count={count}
    />
  )
}
