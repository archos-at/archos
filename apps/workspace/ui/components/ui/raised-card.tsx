'use client'

/**
 * The raised card: a white content block sitting PROUD of a subtler outer
 * surface, with a footer tab on that outer surface carrying quiet metadata.
 *
 * This shape is the product's card. It was written four separate times before
 * this file existed — `documents/file-card.tsx`, `documents/file-grid.tsx`,
 * `cards/DocumentAnswerCard.tsx` and `projects/project-card.tsx` — each
 * carrying its own copy of `rounded-b-[10px] bg-card shadow-xs` over
 * `rounded-xl border bg-muted/50`, and each free to drift from the others by a
 * pixel or a shadow. `file-card.tsx`'s own docstring says it "mirrors
 * ProjectCard / the Archiv library card", which is a comment doing the job a
 * component should.
 *
 * `projects/project-card.tsx` has since been migrated onto this primitive (the
 * projects-home rework, `docs/design/project-surfaces.md`), so three of the
 * four remain. It was moved when it had to change anyway — which is the cheap
 * moment, and the reason to take it: the alternative on the table was a FIFTH
 * copy, hand-rolled inside a new "project atoms" module.
 *
 * The two-surface trick is the whole point and the easiest thing to get subtly
 * wrong: the inner block is rounded only at the BOTTOM (`rounded-surface`)
 * and the outer container clips it, so the block reads as a sheet laid into a
 * tray rather than a box inside a box. The footer is not a bordered section —
 * it is the tray showing beneath the sheet, which is why it needs no divider.
 *
 * Adoption is deliberately incremental: this ships used by the Jobs cards. The
 * four originals keep their hand-rolled copies until each is moved over
 * separately, because they differ in padding, in what they wrap (button, article,
 * anchor) and in their hover behaviour, and collapsing those differences blind
 * is how a refactor breaks four surfaces at once.
 */

import type { JSX } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { motion, springPress, usePrefersReducedMotion } from '@/components/motion'
import { cn } from '@/lib/utils'

export interface RaisedCardProps extends Omit<ComponentProps<'div'>, 'ref'> {
  /**
   * Answers the pointer: the sheet and its tray each go one step down the
   * ladder, as a folder and a row do. On for anything that opens something;
   * off for a card that is a container rather than a target, where an answer
   * promises a click that does not exist.
   */
  interactive?: boolean
  children: ReactNode
}

/** The outer tray. Clips the body's bottom radius and names the group its body answers the pointer in. */
export function RaisedCard({
  interactive = false,
  className,
  children,
  ...rest
}: RaisedCardProps): JSX.Element {
  const reduced = usePrefersReducedMotion()
  const card = (
    <div
      className={cn(
        'border-border bg-desk shadow-sm relative flex h-full min-w-0 flex-col overflow-hidden rounded-surface border',
        'transition-colors duration-quick ease-out motion-reduce:transition-none',
        // The tray is the desk, so under the pointer it is the picked grey; the sheet on it takes its own step
        // (`RaisedCardBody`). It lifted 2px with a deeper shadow until 2026-11-12: a second language beside the fill,
        // and nothing at all in dark, where a shadow does not show on charcoal (V3 of the interaction review).
        interactive && 'group/raised hover:bg-selected',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )

  if (!interactive) return card
  // THE PRESS IS A SPRING. A tap is direct manipulation and must be REVERSIBLE
  // mid-flight: release before the dip completes and the card has to come back
  // from wherever it is, carrying its velocity. That is the one thing a tween
  // cannot do (it restarts from zero velocity and stutters), and it is why
  // `springPress` exists. ζ = 1.00, so the overshoot is 0px at any travel. The
  // dip is the house press, 0.98 (`components/ui/press.ts`).
  //
  // Written as a full `transform` string, not motion's `scale` shorthand: that
  // is a CSS variable run from the main thread, and a file grid is exactly the
  // page that is busy (thumbnails decoding) while a pointer crosses it. A
  // string transform runs on the compositor. Under reduced motion it does not
  // move; the fill still answers the hover. Nothing moves under the pointer
  // alone: the card answers it with its fill.
  return (
    <motion.div
      className="h-full min-w-0 will-change-transform"
      style={{ transform: 'scale(1)' }}
      whileTap={reduced ? undefined : { transform: 'scale(0.98)' }}
      transition={springPress}
    >
      {card}
    </motion.div>
  )
}

/**
 * Flush media well at the top of the raised block (file thumbnails). Sits
 * inside {@link RaisedCardBody} with the body's padding stripped.
 */
export function RaisedCardMedia({
  className,
  children,
  ...rest
}: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn('relative w-full overflow-hidden border-b bg-card', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * The raised white block. Rounded at the bottom only — the top edge is flush
 * with the tray, which is what makes it read as laid in rather than floating.
 *
 * No shadow of its own: the tray owns elevation (including the hover lift), so
 * a shadow here only double-darkens the body's edge against the footer.
 * box-shadow is paint-only, so dropping it cannot move layout.
 */
export function RaisedCardBody({
  className,
  children,
  ...rest
}: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'bg-card w-full overflow-hidden rounded-surface px-4 pb-3 pt-3.5',
        // In a card that opens something, the sheet answers the pointer itself (`group/raised`, the tray's).
        'transition-colors duration-quick ease-out group-hover/raised:bg-sheet-hover motion-reduce:transition-none',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * The footer tab: the tray showing beneath the block.
 *
 * `mt-auto` so it sits at the bottom however tall the body is — which is what
 * keeps footers aligned across a row of cards of differing content height, the
 * thing that makes a grid look like a grid.
 *
 * No top border by design. The separation is the surface change, and adding a
 * divider on top of it reads as two stacked boxes.
 */
export function RaisedCardFooter({
  className,
  children,
  ...rest
}: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn(
        'text-muted-foreground mt-auto flex w-full items-center gap-2 px-4 py-2.5 text-xs',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
