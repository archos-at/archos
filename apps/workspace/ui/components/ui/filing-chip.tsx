'use client'

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type JSX } from 'react'
import { Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from './focus-ring'
import { PRESSABLE } from './press'
import { AgentGlyph } from './agent-glyph'

export function NewMark({ className, ...props }: HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return (
    <span
      data-slot="new-mark"
      className={cn(
        'border-strong text-muted-foreground inline-flex shrink-0 items-center rounded-control border border-dashed px-1 text-[10px] font-medium leading-[14px] tracking-[0.02em] whitespace-nowrap',
        className
      )}
      {...props}
    />
  )
}

export interface FilingChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  target: string
  newLabel?: string
  suggested?: boolean
  mark?: boolean
}

export const FilingChip = forwardRef<HTMLButtonElement, FilingChipProps>(function FilingChip(
  { target, newLabel, suggested = true, mark = true, className, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-haspopup="dialog"
      data-slot="filing-chip"
      data-suggested={suggested || undefined}
      className={cn(
        'border-strong bg-card text-foreground -my-1 inline-flex h-6 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-control border border-dashed pl-[3px] pr-2 text-[11px] font-medium leading-none',
        'hover:bg-sheet-hover aria-expanded:bg-accent hover:border-solid aria-expanded:border-solid',
        !mark && 'border-transparent bg-transparent pl-1 hover:border-transparent aria-expanded:border-transparent',
        PRESSABLE,
        'animate-in fade-in-0 motion-reduce:animate-none',
        'touch-target outline-none',
        FOCUS_RING,
        className
      )}
      {...props}
    >
      {!mark ? (
        <Folder className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      ) : suggested ? (
        <AgentGlyph size="xs" className="size-4" />
      ) : (
        <Folder className="text-muted-foreground ml-[3px] size-3.5 shrink-0" aria-hidden data-testid="filing-chip-folder" />
      )}
      <span className="min-w-0 truncate">
        {/* The folder glyph says where without the mark; the arrow says it with the mark. One sign each. */}
        {mark && <span aria-hidden>→ </span>}
        {target}
      </span>
      {newLabel && <NewMark>{newLabel}</NewMark>}
    </button>
  )
})
