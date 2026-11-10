'use client'

import type { FC } from 'react'

import { ConnectionBand } from '@/components/shell/connection-band'
import { ProjectCrumb } from '@/components/shell/project-crumb'
import { ShellSearchButton } from '@/components/shell/shell-search-button'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { cn } from '@/lib/utils'

interface ChatProjectContextProps {
  /** The active project's name; absent while the project list has not loaded. */
  projectName?: string | null
  className?: string
}

/**
 * Where the reader is, and the way to search, on the chat route of the phone
 * shell.
 *
 * Every other route has a phone band with the project's name, the search and
 * the connection line. Chat hides it because its toolbar is its own top band,
 * which left the one route a person is on most with no word of which project
 * this is, no search and no word that the link is gone. This is the same three
 * atoms the band uses (`ProjectCrumb`, `ShellSearchButton`, `ConnectionBand`),
 * above the toolbar's own pills: orientation first, the thread under it. The
 * way to another project is the first row of „Mehr“ in the tab bar, as on
 * every route.
 *
 * Phone shell only (`md:hidden`, which is `useIsMobile`'s complement). The
 * connection line mounts only there, because its presence check pings on an
 * interval and the rail's indicator already runs one on a desktop.
 */
export const ChatProjectContext: FC<ChatProjectContextProps> = ({ projectName, className }) => {
  const isMobile = useIsMobile()
  return (
    <div
      data-testid="chat-project-context"
      className={cn('pointer-events-none flex flex-col md:hidden', className)}
    >
      {/* The project is the crumb of the chat's own header: a 16px line on the pills' left edge, 8px over them, as
          a page's crumb stands over its title. The search hangs into that line (a 44px target, -14px each side) so
          the row is not a band of its own. The toolbar's header is paper, so the line needs no backing. */}
      <div className="flex h-4 items-center justify-between gap-2">
        {projectName && <ProjectCrumb name={projectName} className="max-w-[75%] pl-1" />}
        <ShellSearchButton className="pointer-events-auto -my-3.5 -mr-2.5 ml-auto" />
      </div>
      {isMobile && <ConnectionBand appearance="line" />}
    </div>
  )
}
