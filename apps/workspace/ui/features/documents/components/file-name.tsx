'use client'

import type { JSX } from 'react'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { DEFAULT_TAIL_LENGTH } from '@/lib/text/middle-truncate'
import { cn } from '@/lib/utils'

/**
 * How much of the end to keep: the last segment and the extension
 * (`_Rohbau.jpg`), not a fixed sixteen characters. On a 156px card a fixed
 * tail left the head three letters ("Ba…") although the name nearly fit; the
 * last segment is what tells two files apart, and the rest may shrink.
 * Segments are `_` and space (a `-` sits inside drawing numbers: `A-101`), a
 * name without one keeps the default, and the tail stays between 8 and the
 * default.
 */
function tailOf(text: string): number {
  const cut = Math.max(text.lastIndexOf('_'), text.lastIndexOf(' '))
  if (cut < 0) return DEFAULT_TAIL_LENGTH
  return Math.min(DEFAULT_TAIL_LENGTH, Math.max(8, text.length - cut))
}

/**
 * A document's or folder's name on a tile or a row: the end of it survives.
 *
 * Revision, drawing number and extension are the END of a name
 * (`Lageplan_Baufeld_Nord_Rev_C_Freigabe.pdf`), and a finger has no tooltip to
 * read the rest, so a long name loses its middle (`MiddleTruncate`) and never
 * its tail.
 *
 * A name that is cut is drawn as two boxes, which a screen reader could read
 * as two words ("Lageplan_Baufe" "ld_Rev_C.pdf"); `MiddleTruncate` hides the
 * drawn pair from assistive technology and gives it the whole name once.
 *
 * The wrapper owns the width (`min-w-0`), so it truncates inside a flex row.
 */
/** Up to this many characters a wrapping name fits three lines of a 156px phone tile whole (two on a desk). */
const WRAP_MAX = 44

/**
 * `wrap`: up to three lines before any cut, for a tile (`Baustellenf…_Rohbau.jpg` lost
 * its start on a phone's two columns). A name that fits two lines is shown
 * whole; a longer one keeps the middle cut on one line.
 */
export function FileName({ text, className, wrap = false }: { text: string; className?: string; wrap?: boolean }): JSX.Element {
  if (wrap && text.length <= WRAP_MAX) {
    // Drawn with a break chance after each `_` (and never inside the extension), read as the one
    // string it is: a `<wbr>` in the accessible text read „Gutachten_ v2.pdf“.
    const parts = text.split('_')
    const wrapClass = cn('line-clamp-3 min-w-0 max-w-full [overflow-wrap:anywhere]', className)
    if (parts.length === 1) return <span className={wrapClass}>{text}</span>
    return (
      <span className={wrapClass}>
        <span aria-hidden>
          {parts.map((part, index) => (
            // No break right after a hyphen (a word joiner, drawn only): `Index-` then „C.pdf“ alone read
            // as a fault. Whole segments would push the end past two lines and lose it.
            <span key={index}>
              {(index < parts.length - 1 ? `${part}_` : part).replaceAll('-', '-\u2060')}
              {index < parts.length - 1 && <wbr />}
            </span>
          ))}
        </span>
        <span className="sr-only">{text}</span>
      </span>
    )
  }
  return (
    <span className={cn('flex min-w-0 max-w-full', className)}>
      <MiddleTruncate text={text} tail={tailOf(text)} />
    </span>
  )
}
