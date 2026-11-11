'use client'

import type { JSX } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { motion, springPress } from '@/components/motion'
import { cn } from '@/lib/utils'

export interface FileTileShellProps extends Omit<ComponentProps<'div'>, 'ref'> {
  interactive?: boolean
  children: ReactNode
}

/**
 * A tile the reader cannot see is not laid out or painted.
 *
 * `content-visibility: auto` lets the browser skip the inside of every tile
 * outside the viewport, which is most of them in a folder of a thousand
 * documents: the DOM, the focus order, find-in-page and the accessibility tree
 * are untouched, only the rendering work waits until a tile scrolls near. A
 * skipped tile is sized from `contain-intrinsic-block-size`: the estimate until
 * it has been drawn once, its real height after (`auto`), so the scrollbar does
 * not jump as the reader scrolls back. The shell already clips its contents
 * (`overflow-hidden`), so the paint containment this brings clips nothing new.
 */
const OFF_SCREEN_SKIP = '[content-visibility:auto] [contain-intrinsic-block-size:auto_240px]'

/**
 * Single rewrite point for the file grid's tiles: the file cards, the folder
 * cards and the skeletons move together when this changes.
 *
 * ## One surface, no tray
 *
 * A tile used to be a tray with a border, a white sheet laid into it with its
 * own divider under the thumbnail, and a footer tab: three planes and three
 * lines around every document, a card in a card, sixteen times a screen. Now a
 * tile is the page itself. The thumbnail is the one object on it (a sheet with
 * a soft shadow, as a page lies on a desk), the name and the facts sit under it
 * in ink and muted ink, and the tile answers the pointer with a fill, not a
 * lift: the same quiet tone a list row takes (`Item`), so a grid and a list
 * hover the same way. Whitespace separates the tiles, not borders
 * (`design-language.md` principle 4; the UI revision's „keine Karte in der
 * Karte, weniger Linien“).
 *
 * The distinction between a folder and a document is made by the tile's
 * CONTENTS: a document shows its first page, a folder a folder. Chroma in this
 * product belongs to the source-signal system, so no tile has a colour of its
 * own.
 */
export function TileShell({ interactive = true, className, children, ...rest }: FileTileShellProps): JSX.Element {
  const shell = (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-col rounded-surface p-1.5',
        OFF_SCREEN_SKIP,
        'transition-colors duration-quick ease-out motion-reduce:transition-none',
        // The hover is the pointer's fill, as a list row's; the open or picked tile holds the selected grey under it too.
        interactive && 'hover:bg-hover',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )

  if (!interactive) return shell
  // The press is the only motion: a fill already answers the hover, and a lift on top of it moved sixteen tiles per sweep.
  return (
    <motion.div className="h-full min-w-0 will-change-transform" whileTap={{ scale: 0.99, transition: springPress }}>
      {shell}
    </motion.div>
  )
}

/** The thumbnail: a white sheet with its edge and elevation 1 (paper on a desk), the document lying on the desk; every tile's the same size. */
export function FileTileMedia({ className, children, ...rest }: ComponentProps<'div'>): JSX.Element {
  return (
    <div className={cn('bg-sheet shadow-sm relative w-full overflow-hidden rounded-surface', className)} {...rest}>
      {children}
    </div>
  )
}

/** The name and what is said about it: on the page, no surface of its own. */
export function FileTileBody({ className, children, ...rest }: ComponentProps<'div'>): JSX.Element {
  return (
    <div className={cn('w-full overflow-hidden', className)} {...rest}>
      {children}
    </div>
  )
}

/** The facts (size, age, what is open), muted, at the foot of the tile. */
export function FileTileFooter({ className, children, ...rest }: ComponentProps<'div'>): JSX.Element {
  return (
    <div className={cn('text-muted-foreground mt-auto flex w-full items-center gap-1.5 pt-1.5 text-xs', className)} {...rest}>
      {children}
    </div>
  )
}
