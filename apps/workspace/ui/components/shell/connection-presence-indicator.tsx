'use client'

import { useTranslations } from '@/i18n'
import { presenceCopy } from '@/i18n/namespaces/presence'
import { RefreshCw, WifiOff, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useConnectionPresence,
  type ConnectionPresence,
} from '@/shared/hooks/use-connection-presence'

const STATE_ICON: Record<ConnectionPresence, LucideIcon | null> = {
  connected: null,
  reconnecting: RefreshCw,
  offline: WifiOff,
}
const ICON_COLOR: Record<ConnectionPresence, string> = {
  connected: 'text-muted-foreground',
  reconnecting: 'text-warning',
  offline: 'text-error',
}

const DOT_COLOR: Record<ConnectionPresence, string> = {
  connected: 'bg-success',
  reconnecting: 'bg-warning',
  offline: 'bg-danger',
}

export interface ConnectionPresenceIndicatorProps {
  compact?: boolean
  className?: string
  presence?: ConnectionPresence
  iconSlot?: boolean
}

export function ConnectionPresenceIndicator({
  compact = false,
  className,
  presence: presenceOverride,
  iconSlot = false,
}: ConnectionPresenceIndicatorProps) {
  const t = useTranslations(presenceCopy)
  const detected = useConnectionPresence({ enablePing: presenceOverride === undefined })
  const presence = presenceOverride ?? detected

  const label = t(`status.${presence}`)
  const StateIcon = STATE_ICON[presence]
  const tooltip = t(`tooltip.${presence}`)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-live="polite"
          aria-label={label}
          data-presence={presence}
          className={cn(
            'inline-flex min-h-4 rounded-control text-xs text-muted-foreground select-none',
            iconSlot ? 'max-w-full items-start gap-[11px]' : 'items-center gap-2',
            className,
          )}
        >
          {StateIcon ? (
            <StateIcon className={cn('shrink-0', iconSlot || compact ? 'size-4' : 'size-3.5', ICON_COLOR[presence])} aria-hidden />
          ) : (
            <span className={cn('relative flex shrink-0 items-center justify-center', iconSlot ? 'size-4' : 'size-2')} aria-hidden>
              <span className={cn('relative inline-flex size-2 rounded-full', DOT_COLOR[presence])} />
            </span>
          )}
          {!compact && <span className={cn('min-w-0', !iconSlot && 'truncate')}>{label}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent className="motion-reduce:animate-none">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
