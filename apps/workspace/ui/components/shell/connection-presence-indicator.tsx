'use client'

/**
 * ConnectionPresenceIndicator
 *
 * A quiet, native-app-style status readout for the app shell: a small colored
 * dot (plus an optional label) that communicates live connection health so the
 * product never feels dead or ambiguous.
 *
 *   connected    -> subtle success dot, no motion. The shell does not show this
 *                   state: it mounts the indicator through `ConnectionBand`,
 *                   which hides it while connected (a fine status says nothing)
 *   reconnecting -> amber dot with a soft ping pulse (suppressed under
 *                   prefers-reduced-motion)
 *   offline      -> danger dot, no motion
 *
 * Accessibility: the wrapper is a `role="status"` / `aria-live="polite"` region
 * so assistive tech announces state changes calmly, not on every render. The
 * human-readable explanation is available both as the region's `aria-label` and
 * in a hover/focus tooltip. Colour is never the only signal -- the label and
 * tooltip carry the meaning in text.
 */

import { useTranslations } from '@/i18n'
import { presenceCopy } from '@/i18n/namespaces/presence'
import { RefreshCw, WifiOff, type LucideIcon } from 'lucide-react'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useConnectionPresence,
  type ConnectionPresence,
} from '@/shared/hooks/use-connection-presence'

/** The icon rail's glyph per state, where no words stand beside it. */
const COMPACT_ICON: Record<ConnectionPresence, LucideIcon | null> = {
  connected: null,
  reconnecting: RefreshCw,
  offline: WifiOff,
}
const ICON_COLOR: Record<ConnectionPresence, string> = {
  connected: 'text-muted-foreground',
  reconnecting: 'text-warning',
  offline: 'text-error',
}

/** Solid dot fill per state (feedback tokens from styles/tokens.css). */
const DOT_COLOR: Record<ConnectionPresence, string> = {
  connected: 'bg-success',
  reconnecting: 'bg-warning',
  offline: 'bg-danger',
}

export interface ConnectionPresenceIndicatorProps {
  /** Render only the dot (e.g. the collapsed sidebar rail). */
  compact?: boolean
  className?: string
  /**
   * Force a presence state instead of reading the live signal. Used by tests
   * and stories; production callers omit it so the hook drives the state.
   */
  presence?: ConnectionPresence
  /**
   * Stand the dot in a 16px slot with the rail's 11px gap, so a rail row lines
   * up with the section icons and labels above it.
   */
  iconSlot?: boolean
}

export function ConnectionPresenceIndicator({
  compact = false,
  className,
  presence: presenceOverride,
  iconSlot = false,
}: ConnectionPresenceIndicatorProps) {
  const t = useTranslations(presenceCopy)
  // A caller that passes the state already runs the ping (`ConnectionBand`);
  // a second one here doubled the health requests of every shell.
  const detected = useConnectionPresence({ enablePing: presenceOverride === undefined })
  const presence = presenceOverride ?? detected

  const label = t(`status.${presence}`)
  const CompactIcon = COMPACT_ICON[presence]
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
            // In a rail row the words may take two lines rather than lose
            // their end („Verbindung wird wiederh…“): the dot then stands by
            // the first line, in a slot as tall as it.
            iconSlot ? 'max-w-full items-start gap-[11px]' : 'items-center gap-2',
            'outline-none',
            FOCUS_RING_INSET,
            className,
          )}
        >
          {compact && CompactIcon ? (
            // Alone in the icon rail a dot was colour carrying the meaning by
            // itself: the glyph says it in shape too.
            <CompactIcon className={cn('size-4', ICON_COLOR[presence])} aria-hidden />
          ) : (
          <span className={cn('relative flex shrink-0 items-center justify-center', iconSlot ? 'size-4' : 'size-2')} aria-hidden>
            {presence === 'reconnecting' && (
              // Intentional `animate-ping`, not the ambient shimmer loop: a
              // reconnect is an EVENT that must catch the eye once and then
              // resolve (to the still dot or to offline), never a background
              // state to breathe at `--motion-ambient`. Removed entirely under
              // reduced-motion.
              <span
                className={cn(
                  'absolute inline-flex size-2 rounded-full opacity-60',
                  'animate-ping bg-warning motion-reduce:hidden motion-reduce:animate-none',
                )}
              />
            )}
            <span
              className={cn(
                'relative inline-flex size-2 rounded-full',
                DOT_COLOR[presence],
              )}
            />
          </span>
          )}
          {!compact && <span className={cn('min-w-0', !iconSlot && 'truncate')}>{label}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent className="motion-reduce:animate-none">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
