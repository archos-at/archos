import type { JSX } from 'react'
import { cn } from '@/lib/utils'
import { DEFAULT_TAIL_LENGTH, splitForMiddleTruncation } from '@/lib/text/middle-truncate'

export interface MiddleTruncateProps {
  text: string
  tail?: number
  className?: string
}

export function MiddleTruncate({ text, tail = DEFAULT_TAIL_LENGTH, className }: MiddleTruncateProps): JSX.Element {
  const split = splitForMiddleTruncation(text, tail)
  if (!split.head) {
    return (
      <span className={cn('inline-flex min-w-0 max-w-full whitespace-nowrap', className)} title={text}>
        <LastResortTail text={text} />
      </span>
    )
  }
  return (
    <span className={cn('inline-flex min-w-0 max-w-full whitespace-nowrap', className)} title={text}>
      <span className="sr-only">{text}</span>
      {/* `whitespace-pre` on both halves: they are flex items, and a flex
          item's leading or trailing space collapses, so a cut that fell next
          to a space ("Plan EG" → "Plan" + " EG") ran the words together.
          The head gives way first (its shrink factor dwarfs the tail's), all
          the way to nothing; only then does the tail. */}
      <span aria-hidden data-part="head" className="min-w-0 shrink-[100000] overflow-hidden text-ellipsis whitespace-pre">
        {split.head}
      </span>
      <LastResortTail text={split.tail} aria-hidden />
    </span>
  )
}

function LastResortTail({ text, ...rest }: { text: string; 'aria-hidden'?: boolean }): JSX.Element {
  return (
    <span {...rest} data-part="tail" dir="rtl" className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
      <bdi dir="ltr">{text}</bdi>
    </span>
  )
}
