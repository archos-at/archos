'use client'

import type { JSX, ReactNode } from 'react'

import { keepUnitsTogether } from '@/lib/text/keep-units'
import type { TextSegment } from '@/lib/text/term-segments'
import { cn } from '@/lib/utils'
import { useCompactRow } from './row-frame'

export function MatchMark({ children, testId }: { children: ReactNode; testId?: string }): JSX.Element {
  const compact = useCompactRow()
  return (
    <mark
      className={cn('font-medium text-foreground', compact ? 'bg-transparent' : 'rounded-[2px] bg-foreground/[0.08] [box-decoration-break:clone]')}
      data-testid={testId}
    >
      {children}
    </mark>
  )
}

export function MatchedSegments({ segments, testId, keepUnits = true }: { segments: readonly TextSegment[]; testId: string; keepUnits?: boolean }): JSX.Element {
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <MatchMark key={index} testId={testId}>
            {segment.text}
          </MatchMark>
        ) : (
          <span key={index}>{keepUnits ? keepUnitsTogether(segment.text) : segment.text}</span>
        )
      )}
    </>
  )
}
