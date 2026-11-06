'use client'

import type { JSX } from 'react'
import { ChevronDown } from 'lucide-react'

import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { cn } from '@/lib/utils'
import { ProjectMark } from './project-mark'

/**
 * The project's name on a phone, and the door to the switcher sheet.
 *
 * The tonal secondary press (D4) at 44px: white on the phone's grey project
 * band (`data-surface="sunken"`), the one grey where it floats over the
 * chat's white page, and never a box. It was a raised card with a hairline and
 * a shadow. A fill and not the desktop switcher's bare row, because over the
 * chat the thread scrolls under it. It stands in two places: the phone header,
 * and the chat toolbar, whose route has no phone header (`ChatToolbar`). One
 * atom, so the two cannot drift.
 */
export function ProjectPill({
  name,
  label,
  expanded,
  onOpen,
  className,
}: {
  name: string
  label: string
  expanded: boolean
  onOpen: () => void
  className?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      data-testid="project-pill"
      className={cn(
        'bg-muted in-data-[surface=sunken]:bg-on-sunken flex min-h-11 py-1 min-w-0 max-w-[min(100%,20rem)] items-center gap-2.5 rounded-control pl-3 pr-2.5 text-left outline-none',
        PRESSABLE,
        FOCUS_RING,
        className
      )}
    >
      {/* White in the grey phone band, where the pill is white: then the mark is the one grey; over the chat's white page the pill is grey and the mark white. */}
      <ProjectMark name={name} className="bg-on-sunken in-data-[surface=sunken]:bg-muted" />
      {/* Two lines before a cut: the end of a name („Baufeld D12") is what
          tells sibling projects apart. */}
      <span className="text-foreground line-clamp-2 min-w-0 flex-1 text-[15px] leading-tight font-medium">
        {name}
      </span>
      <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </button>
  )
}
