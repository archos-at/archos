'use client'

import type { JSX } from 'react'
import { MailCheck, MailClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

/** What filing the text starts for its Verlauf, said plainly, with the way out of it right there. */
export function FollowLine({ follow, onFollow }: { follow: boolean; onFollow: (follow: boolean) => void }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const Icon = follow ? MailCheck : MailClock
  return (
    <span className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs leading-snug" data-testid="filing-follow-note" data-follow={follow}>
      <span className="text-foreground inline-flex min-w-0 items-start gap-1.5">
        <Icon className="text-muted-foreground mt-px size-3.5 shrink-0" aria-hidden />
        <span>{follow ? t('filing.overview.follow') : t('filing.overview.noFollow')}</span>
      </span>
      <Button type="button" variant="inline" className="touch-target h-auto p-0 text-xs font-medium" onClick={() => onFollow(!follow)} data-testid="filing-follow-toggle">
        {follow ? t('filing.overview.followStop') : t('filing.overview.followStart')}
      </Button>
    </span>
  )
}
