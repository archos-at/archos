'use client'

import type { JSX, ReactNode } from 'react'

import { Chip } from '@/components/ui/chip'
import type { TextSegment } from '@/lib/text/term-segments'
import { cn } from '@/lib/utils'
import { CompactMatchHint, CompactPassage } from '../palette-atoms'
import { MatchedSegments } from '../match-mark'
import { useCompactRow } from '../row-frame'

export function PassageQuote({ segments, page }: { segments: readonly TextSegment[]; page?: string }): JSX.Element {
  if (useCompactRow()) return <CompactPassage segments={segments} page={page} />
  return (
    <p className="mt-1 flex min-w-0 items-baseline gap-2 border-l-2 border-border pl-2.5 text-sm leading-relaxed text-foreground/80" data-testid="search-passage">
      {page ? (
        <Chip size="sm" variant="outline" className="shrink-0 tabular-nums">
          {page}
        </Chip>
      ) : null}
      <span className="line-clamp-2 min-w-0 text-pretty">
        „<MatchedSegments segments={segments} testId="search-passage-match" />“
      </span>
    </p>
  )
}

export function MatchedText({ segments }: { segments: readonly TextSegment[] }): JSX.Element {
  return <MatchedSegments segments={segments} testId="search-title-match" keepUnits={false} />
}

export function Excerpt({ children }: { children: ReactNode }): JSX.Element {
  const compact = useCompactRow()
  return <p className={cn('text-foreground/75', compact ? 'truncate text-xs leading-5 text-muted-foreground' : 'mt-0.5 line-clamp-2 text-pretty text-sm')}>{children}</p>
}

export function MatchHint({ label, parts, testId = 'search-matched-on' }: { label: string; parts: readonly string[]; testId?: string }): JSX.Element {
  if (useCompactRow()) return <CompactMatchHint label={label} parts={parts} testId={testId} />
  return (
    <span className="mt-0.5 text-xs text-muted-foreground" data-testid={testId}>
      {label} {parts.join(' · ')}
    </span>
  )
}
