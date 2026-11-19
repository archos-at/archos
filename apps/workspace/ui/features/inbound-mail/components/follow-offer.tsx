'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { FollowSwitch } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { cn } from '@/lib/utils'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface FollowOfferProps {
  threadName: string
  onFollow: () => Promise<void>
  onUnfollow?: () => Promise<void>
  following?: boolean
  className?: string
}

/** After a reply is filed, the switch for the Verlauf's further replies, as the Verlauf's „E-Mails“ tab shows it. */
export function FollowOffer({ threadName, onFollow, onUnfollow, following = false, className }: FollowOfferProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } catch {
      // The caller says what failed; the switch stands as it was.
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={cn('bg-card rounded-surface flex flex-col gap-1.5 border p-3', className)}
      data-testid="follow-offer"
      data-following={following || undefined}
      aria-label={t('follow.thread', { name: threadName })}
    >
      <p className="text-muted-foreground text-xs [overflow-wrap:anywhere]" data-testid="follow-offer-title">
        {t('follow.thread', { name: threadName })}
      </p>
      <FollowSwitch
        on={following}
        disabled={busy || (following && !onUnfollow)}
        onChange={(on) => void run(on ? onFollow : (onUnfollow ?? onFollow))}
        testId="follow-offer-switch"
      />
    </section>
  )
}
