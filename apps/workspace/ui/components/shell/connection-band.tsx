'use client'

import type { JSX } from 'react'

import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { presenceCopy } from '@/i18n/namespaces/presence'
import { requestConnectionCheck, useConnectionPresence } from '@/shared/hooks/use-connection-presence'
import { cn } from '@/lib/utils'
import { ConnectionPresenceIndicator } from './connection-presence-indicator'

const APPEARANCE = {
  band: 'h-7 justify-center px-4',
  line: 'h-6 justify-start px-1',
  rail: 'min-h-9 flex-col items-start justify-center gap-2 px-3 py-2.5',
} as const

export function ConnectionBand({
  className,
  appearance = 'band',
  compact = false,
}: {
  className?: string
  appearance?: keyof typeof APPEARANCE
  compact?: boolean
}): JSX.Element {
  const t = useTranslations(presenceCopy)
  const presence = useConnectionPresence()
  const quiet = presence === 'connected'
  return (
    <div
      data-slot="connection-band"
      data-presence={presence}
      className={cn(
        quiet
          ? 'sr-only'
          : cn(
              'animate-in fade-in-0 duration-quick flex w-full shrink-0 items-center motion-reduce:animate-none',
              compact ? 'size-9 justify-center' : APPEARANCE[appearance]
            ),
        className
      )}
    >
      <ConnectionPresenceIndicator presence={presence} compact={compact} iconSlot={appearance === 'rail'} />
      {/* While the server does not answer, a way to ask now rather than at the
          next interval. Offline has none: the browser says when the network
          is back, and the page then checks by itself. */}
      {presence === 'reconnecting' && !compact && appearance === 'rail' && (
        <Button type="button" variant="secondary" size="sm" onClick={requestConnectionCheck} className="ml-[27px]">
          {t('retry')}
        </Button>
      )}
      {presence === 'reconnecting' && !compact && appearance !== 'rail' && (
        <button
          type="button"
          onClick={requestConnectionCheck}
          className="text-foreground touch-target ml-2 shrink-0 rounded-control text-xs font-medium underline underline-offset-2"
        >
          {t('retry')}
        </button>
      )}
    </div>
  )
}
