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
      <div className="flex items-center justify-between gap-2">
        {/* The thread scrolls under this row: the name stands on a strip of the page's paper. */}
        {projectName && <ProjectCrumb name={projectName} className="bg-background max-w-[75%] rounded-control px-2 py-1" />}
        <ShellSearchButton className="pointer-events-auto ml-auto" />
      </div>
      {isMobile && <ConnectionBand appearance="line" />}
    </div>
  )
}
