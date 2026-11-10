'use client'

import type { JSX } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import { FOCUS_RING } from '@/components/ui/focus-ring'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { PRESSABLE } from '@/components/ui/press'
import { cn } from '@/lib/utils'
/**
 * The project's name on a phone, and the door to the switcher sheet.
 *
 * The rail's project selector at a finger's size: a press (Paper on a desk,
 * principle 4), white with the 12% edge, radius 6, 44px, the name at 16/600 on
 * one line, cut in the middle when it does not fit, never wrapped. In dark a
 * press is its plane's own fill with the edge, and opaque here, because over
 * the chat the thread scrolls under it. It stands in two places: the phone header, and the chat
 * toolbar, whose route has no phone header (`ChatToolbar`). One atom, so the
 * two cannot drift.
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
        'bg-sheet shadow-press dark:bg-background flex h-11 min-w-0 max-w-[min(100%,20rem)] items-center gap-2 rounded-control pr-2.5 pl-3 text-left outline-none',
        PRESSABLE,
        FOCUS_RING,
        className
      )}
    >
      {/* One line, and the cut in the middle: the end of a name („Baufeld
          D12") is what tells sibling projects apart. */}
      <MiddleTruncate text={name} tail={12} className="text-foreground min-w-0 flex-1 text-base font-semibold" />
      <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </button>
  )
}
