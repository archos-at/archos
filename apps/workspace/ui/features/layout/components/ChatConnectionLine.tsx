'use client'

import type { FC } from 'react'

import { ConnectionBand } from '@/components/shell/connection-band'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { cn } from '@/lib/utils'

/**
 * The connection's line over the chat's toolbar, on the phone shell.
 *
 * Every other route has the shell's top line for it. Chat hides that, because
 * its toolbar is its own top, which left the one route a person is on most
 * with no word that the link is gone. It takes no room while the link is fine.
 *
 * It used to carry the project's name and the search above the pills
 * (`ChatProjectContext`). Neither stands at the top of a phone page now: the
 * project is the first row of „Mehr“, and the search is listed there too.
 *
 * Phone shell only (`md:hidden`, which is `useIsMobile`'s complement): the
 * presence check pings on an interval, and the rail's row already runs one on
 * a desktop.
 */
export const ChatConnectionLine: FC<{ className?: string }> = ({ className }) => {
  const isMobile = useIsMobile()
  return (
    <div data-testid="chat-connection-line" className={cn('pointer-events-none flex flex-col md:hidden', className)}>
      {isMobile && <ConnectionBand appearance="line" />}
    </div>
  )
}
