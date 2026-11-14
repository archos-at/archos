'use client'

import type { JSX } from 'react'
import { FittedName } from '@/components/ui/fitted-name'

/**
 * A document's name on a tile or a row, by the one rule every file name follows
 * (`fitName`): whole where it fits, broken only between words („_“, „-“, a
 * space), else cut in the middle so its end survives (the revision, the drawing
 * number and the extension: `Lageplan_Baufeld_Nord_Rev_C_Freigabe.pdf`), else
 * at its end. A tile gives it two lines, a row one.
 *
 * It was three rules: a tile wrapped with `overflow-wrap: anywhere` up to 54
 * characters and cut longer ones on one line, a row cut with `MiddleTruncate`,
 * so one name broke mid-word in one state („Baustellenbesprechun/g.pdf“) and
 * was cut in another, and a row showed „R“ where the ellipsis had no room
 * (review of 2026-11-10, findings 5, 16 and 17).
 *
 * A folder's name is cut at its end (its start tells it apart): `FolderName`.
 */
export function FileName({
  text,
  className,
  lines = 1,
  firstLineInset,
}: {
  text: string
  className?: string
  lines?: number
  /** Pixels the first line leaves free at its end (the tile's ⋯). */
  firstLineInset?: number
}): JSX.Element {
  return <FittedName text={text} lines={lines} firstLineInset={firstLineInset} className={className} />
}

/** A folder's name on one line, cut at its end with its whole name as its title. */
export function FolderName({ text, className }: { text: string; className?: string }): JSX.Element {
  return (
    <span className={`block min-w-0 truncate ${className ?? ''}`} title={text}>
      {text}
    </span>
  )
}
