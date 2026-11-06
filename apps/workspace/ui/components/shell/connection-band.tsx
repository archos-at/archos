'use client'

/**
 * The connection state where it is seen, and only while it is not fine.
 *
 * A status that is fine says nothing (design-language.md, „The app rail“): the
 * rail's footer used to carry a green „Verbunden“ dot all day, the one colour
 * on the rail and it meant nothing. Now every surface reads this band, which
 * says so while the link is gone or coming back and takes no space while all
 * is well. The status region stays in the tree while connected, visually
 * hidden, so the change to offline is announced rather than inserted silently.
 *
 * On a phone it is a line in the top band (the rail's footer is inside a closed
 * drawer there, and the reader most likely to lose the network, on site or in a
 * basement, learned it only after a send failed). On a desktop it is a row in
 * the rail's footer, above the person. Each shell mounts one, because the
 * presence hook pings on an interval.
 */

import type { JSX } from 'react'

import { useConnectionPresence } from '@/shared/hooks/use-connection-presence'
import { cn } from '@/lib/utils'
import { ConnectionPresenceIndicator } from './connection-presence-indicator'

const APPEARANCE = {
  /** A full-width line under a header's row, inside its band: no rule of its own. */
  band: 'h-7 justify-center px-4',
  /** A thin line of text with no fill, for a header that floats over content (the chat toolbar). */
  line: 'h-6 justify-start px-1',
  /** A rail row: the dot in the icons' 16px slot at 24px, the words on the labels' edge. */
  rail: 'min-h-9 justify-start px-3 py-2.5',
} as const

export function ConnectionBand({
  className,
  appearance = 'band',
  compact = false,
}: {
  className?: string
  appearance?: keyof typeof APPEARANCE
  /** The icon rail: the dot alone in a 36px tile, its words in the tooltip and the status's name. */
  compact?: boolean
}): JSX.Element {
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
    </div>
  )
}
