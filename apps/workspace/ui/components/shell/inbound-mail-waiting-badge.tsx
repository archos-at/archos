'use client'

import type { JSX } from 'react'
import { CountPill } from '@/components/ui/count-pill'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { navCopy } from '@/i18n/namespaces/nav'
import { SHELL_COUNT } from './shell-count'
import { cn } from '@/lib/utils'

export function InboundMailWaitingBadge({ count, more = false, className }: { count: number | null; more?: boolean; className?: string }): JSX.Element | null {
  const t = useTranslations(navCopy)
  const tFiles = useTranslations(filesCopy)
  if (count === null || !Number.isFinite(count) || count <= 0) return null
  const label = more ? tFiles('inboundMail.waitingLineMore', { count }) : t('inboundMailWaiting', { count })
  return (
    <CountPill
      tone="muted"
      role="status"
      aria-label={label}
      title={label}
      data-testid="inbound-mail-badge"
      data-waiting={count}
      data-more={more || undefined}
      className={cn(SHELL_COUNT, className)}
      {...(more ? { children: <span aria-hidden>{`${count}+`}</span> } : { count })}
    />
  )
}
