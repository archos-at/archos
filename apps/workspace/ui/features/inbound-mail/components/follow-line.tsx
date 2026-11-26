'use client'

import type { JSX } from 'react'
import { useId } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toggletip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { CLAUSE_JOIN } from '@/lib/format'
import { MAIL_THREAD_FOLLOW_DEFAULT_DAYS } from '@/lib/mail-thread/mail-thread-wire'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

/** A default one turns off, not a question: one quiet line in „Übersicht“; the Verlauf's „E-Mails“ tab keeps the switch. */
export function FollowLine({ follow, onFollow }: { follow: boolean; onFollow: (follow: boolean) => void }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const tThread = useTranslations(mailThreadCopy)
  const stateId = useId()
  const explain = tThread('follow.explain', { days: MAIL_THREAD_FOLLOW_DEFAULT_DAYS })
  return (
    <p className="text-muted-foreground mt-1 text-xs leading-snug [overflow-wrap:break-word]" data-testid="filing-follow" data-on={follow}>
      <span id={stateId} data-testid="filing-follow-state">
        {t(follow ? 'filing.overview.followLineOn' : 'filing.overview.followLineOff')}
      </span>
      {CLAUSE_JOIN}
      <Button
        type="button"
        variant="inline"
        className="touch-target h-auto p-0 text-xs font-medium"
        aria-describedby={stateId}
        onClick={() => onFollow(!follow)}
        data-testid="filing-follow-control"
      >
        {t(follow ? 'filing.overview.followTurnOff' : 'filing.overview.followTurnOn')}
      </Button>{' '}
      <Toggletip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="hover:text-foreground touch-target inline-flex size-4 items-center justify-center rounded-inline align-[-3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label={explain}
            data-testid="filing-follow-explain"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{explain}</TooltipContent>
      </Toggletip>
    </p>
  )
}
