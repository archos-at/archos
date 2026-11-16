'use client'

import type { CSSProperties, JSX, ReactNode } from 'react'
import { forwardRef } from 'react'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'
import { rgbCss, type Rgb } from './lib/tint'

export function ChangeBadge({ number, active = false, className }: { number: number; active?: boolean; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--compare-mark)] text-[11px] leading-none font-semibold text-[var(--compare-paper)] tabular-nums',
        active && 'ring-2 ring-[var(--compare-mark)] ring-offset-1 ring-offset-background',
        className,
      )}
    >
      {number}
    </span>
  )
}

export function Swatch({ ink }: { ink: Rgb }): JSX.Element {
  return <span aria-hidden className="ring-border size-3 shrink-0 rounded-[3px] ring-1" style={{ background: rgbCss(ink) }} />
}

export function SwatchLabel({ ink, children, title }: { ink: Rgb; children: ReactNode; title?: string }): JSX.Element {
  return (
    <li className="text-foreground flex items-center gap-1.5" title={title}>
      <Swatch ink={ink} />
      {children}
    </li>
  )
}

export function SheetTag({ side, label, name, style }: { side: 'left' | 'right'; label: string; name: string; tail?: number; style?: CSSProperties }): JSX.Element {
  return (
    <span
      data-testid={`sheet-tag-${side}`}
      className={cn(
        'pointer-events-none absolute top-2 z-[5] flex max-w-[calc(50%-0.75rem)] min-w-0 items-center gap-1.5 overflow-hidden rounded-control bg-[var(--compare-paper-ink)] px-1.5 py-0.5 text-xs text-[var(--compare-paper)] shadow-sm',
        side === 'left' ? 'left-2' : 'right-2',
      )}
      style={style}
    >
      <span className="shrink-0 font-medium">{label}</span>
      {/* Cut at the START, not the middle: a tag on a small sheet has room
          for a dozen characters, and a middle cut there left „G…ss_1OG_B.pdf"
          reading as „Gss". The end is the part that tells the two apart. */}
      <span dir="rtl" className="min-w-0 truncate text-left opacity-80" title={name}>
        <bdi dir="ltr">{name}</bdi>
      </span>
    </span>
  )
}

export const PaperSheet = forwardRef<HTMLDivElement, { width: number; height: number; children: ReactNode }>(
  function PaperSheet({ width, height, children }, ref) {
    return (
      <div
        ref={ref}
        className="ring-border relative isolate m-auto shrink-0 bg-[var(--compare-paper)] shadow-sm ring-1"
        style={{ width, height }}
      >
        {children}
      </div>
    )
  },
)

export function PaneCaption({ caption, name, tail }: { caption: string; name: string; tail?: number }): JSX.Element {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-4">
      <SectionLabel className="shrink-0">{caption}</SectionLabel>
      <MiddleTruncate text={name} tail={tail} className="text-foreground text-xs" />
    </div>
  )
}

export function StageBar({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div
      data-testid="compare-stage-bar"
      className={cn('flex min-h-11 flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-4 py-1.5 text-sm', className)}
    >
      {children}
    </div>
  )
}
