'use client'

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type JSX } from 'react'
import { Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from './focus-ring'
import { PRESSABLE } from './press'
import { AgentGlyph } from './agent-glyph'

/**
 * NewMark — the quiet „neu" beside a folder that a move would create. A dashed
 * edge in the strongest hairline and muted ink, no fill: it qualifies the name
 * beside it and must not outshout it. No colour either, because chroma in this
 * product says where a source comes from (`design-language.md`), and a
 * green „neu" would read as „Projekt".
 */
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
  /** Where the suggestion would put the thing: the folder's own name, never its whole path. */
  target: string
  /** „neu", when the move creates the folder. */
  newLabel?: string
  /**
   * Whether the target IS the agent's suggestion (default). False for a folder a
   * rule or the person chose: the chip then wears a folder glyph, never
   * The agent's mark, because the mark claims the agent stands behind the place
   * (VISION: traceable; `lib/inbound-mail/suggest.ts` gives no suggestion on
   * an unconfirmed or forged mail, and a regex default must not look like one).
   */
  suggested?: boolean
  /**
   * The glyph before the target (default). False where a line above already
   * says whose suggestion it is („Vorschlag von {productName}“ over a mail's
   * attachment): the chip is then the target as words with a folder glyph, no
   * pill, so it does not read as the type's pill beside it and the row says it once.
   */
  mark?: boolean
}

/**
 * FilingChip — where something will be filed, as a pill that opens the
 * decision: The agent's glyph when it is the agent's suggestion (a folder glyph when
 * a rule or the person chose it), „→ Bescheide", and „neu" for a folder the
 * move creates.
 *
 * Calm by default, because after a batch upload ten of these may sit on one
 * screen: the card's own surface, no fill colour of its own, a DASHED edge in
 * the strongest hairline that says „not yet". The edge turns solid on hover
 * and while the popover it opens is open (`aria-expanded`).
 *
 * It never makes the line it sits in taller: 24px tall with `-my-1`, so its
 * margin box is the 16px of a line of `text-xs`, and a card footer or a list
 * row with a chip is exactly as tall as one without. The glyph and „neu" never
 * shrink; only the folder's name ellipsizes, and the full path is in the
 * popover. It fades in (opacity only) and holds still otherwise.
 *
 * A button with `aria-haspopup="dialog"`, meant to be a Radix trigger
 * (`PopoverTrigger asChild`), so it forwards its ref and every prop.
 */
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
        'hover:bg-accent aria-expanded:bg-accent hover:border-solid aria-expanded:border-solid',
        // Without the mark it is the target as words with a folder glyph, not a second pill beside the type's.
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
