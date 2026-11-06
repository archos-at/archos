'use client'

import type { JSX } from 'react'

import { cn } from '@/lib/utils'
import { projectInitials } from './project-list'

/**
 * The project's mark (and the organisation's, heading its doorways in the
 * rail): its initials in a 24px square, the one grey on white and
 * white where it sits on the rail's grey band (`onBand`). It replaced a dashed
 * ring that was the same for every project, green for the current one
 * whatever its status: a glyph that told no project from another, in a status
 * colour that said nothing. The icon rail shows this mark alone, so it has to
 * name the project.
 */
export function ProjectMark({
  name,
  onBand = false,
  className,
}: {
  name: string
  /** On the rail's band at rest: white. Elsewhere (a white pill, a menu, the sheet): the one grey. */
  onBand?: boolean
  className?: string
}): JSX.Element {
  const initials = projectInitials(name)
  return (
    <span
      aria-hidden
      data-slot="project-mark"
      className={cn(
        // 12px initials, weight 500, as the avatar's monogram, with 4px of the
        // square showing round them: at 20px the initials filled it edge to
        // edge and read as loose text beside the name.
        'text-foreground flex size-6 shrink-0 items-center justify-center rounded-inline text-xs leading-none font-medium',
        onBand ? 'bg-on-sunken' : 'bg-muted',
        className
      )}
    >
      {initials}
    </span>
  )
}
