'use client'

/**
 * The law map's atoms: the path you walked, a folder row, the squares that
 * show which edition binds per topic, the timeline of a region, and a
 * statement's review state. Shape lives here; the views compose them.
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, Folder, Scale, ScrollText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ReviewState } from '@/lib/base-knowledge/platform/law-map'

/** The path from the country to here, each step a link up the tree. */
export function PathBar({ steps, label }: { steps: { href: string; name: string }[]; label: string }): JSX.Element {
  return (
    <nav aria-label={label} className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm">
      {steps.map((step, index) => (
        <span key={step.href} className="inline-flex items-center gap-1">
          {index > 0 ? <ChevronRight className="size-3.5 opacity-60" aria-hidden /> : null}
          {index === steps.length - 1 ? (
            <span aria-current="page" className="text-foreground font-medium">
              {step.name}
            </span>
          ) : (
            <Link href={step.href} className="hover:text-foreground rounded px-1 hover:underline">
              {step.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}

const ICONS = { folder: Folder, act: ScrollText, law: Scale } as const

/** One item in a folder: a region, an act, a building law. The whole row is the link. */
export function FolderRow({ href, icon, name, meta, end, external = false }: { href: string; icon: keyof typeof ICONS; name: string; meta?: ReactNode; end?: ReactNode; external?: boolean }): JSX.Element {
  const Icon = ICONS[icon]
  const body = (
    <>
      <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words">{name}</span>
        {meta ? <span className="text-muted-foreground block text-xs break-words">{meta}</span> : null}
      </span>
      {end ? <span className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-start max-sm:pl-11">{end}</span> : null}
      <ChevronRight className="text-muted-foreground size-4 shrink-0 max-sm:hidden" aria-hidden />
    </>
  )
  const className = 'hover:bg-accent flex items-center gap-3 border-t px-4 py-3 first:border-t-0 max-sm:flex-wrap'
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  )
}

/** A bordered list of `FolderRow`s, with its heading. */
export function FolderList({ heading, children }: { heading?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      {heading ? <h2 className="text-muted-foreground text-xs font-medium">{heading}</h2> : null}
      <div className="bg-card overflow-hidden rounded-lg border">{children}</div>
    </section>
  )
}

/** Shades by recency: the newest edition darkest. Index 0 is the oldest. */
const SHADES = ['bg-primary/15 text-foreground', 'bg-primary/35 text-foreground', 'bg-primary/65 text-primary-foreground', 'bg-primary text-primary-foreground']

export function shadeOf(rank: number, of: number): string {
  if (of <= 1) return SHADES[SHADES.length - 1] ?? ''
  const index = Math.round((rank / (of - 1)) * (SHADES.length - 1))
  return SHADES[index] ?? ''
}

/** One square per topic, the edition in force today: a region's fingerprint. */
export function EditionSquares({ squares }: { squares: { key: string; label: string | null; shade: string; title: string }[] }): JSX.Element {
  return (
    <span className="inline-flex gap-0.5">
      {squares.map((square) => (
        <span
          key={square.key}
          title={square.title}
          className={cn('h-[18px] w-[22px] rounded-[3px] text-center font-mono text-[10px] leading-[18px]', square.label ? square.shade : 'bg-muted text-muted-foreground')}
        >
          {square.label ?? '–'}
        </span>
      ))}
    </span>
  )
}

export interface TimelineSegment {
  key: string
  from: number
  to: number
  label: string
  shade: string
  href: string
  title: string
}

/** One topic's editions over time, on a shared axis in percent; `today` is a line. */
export function TimelineRow({ label, sub, segments, today }: { label: string; sub: string; segments: TimelineSegment[]; today: number }): JSX.Element {
  return (
    <>
      <div className="text-sm">
        {label}
        <span className="text-muted-foreground block text-xs leading-tight">{sub}</span>
      </div>
      <div className="bg-muted relative h-6 rounded">
        {segments.map((segment) => (
          <Link
            key={segment.key}
            href={segment.href}
            title={segment.title}
            className={cn('border-background absolute inset-y-0 overflow-hidden rounded border px-1.5 font-mono text-[11px] leading-6 whitespace-nowrap', segment.shade)}
            style={{ left: `${segment.from}%`, width: `${Math.max(segment.to - segment.from, 0.5)}%` }}
          >
            {segment.label}
          </Link>
        ))}
        <span className="bg-destructive absolute -inset-y-1 w-0.5 rounded" style={{ left: `${today}%` }} aria-hidden />
      </div>
    </>
  )
}

/** The timeline's frame: a label column and the axis, scrolling sideways on a phone. */
export function TimelineFrame({ ticks, children }: { ticks: { at: number; label: string }[]; children: ReactNode }): JSX.Element {
  return (
    <div className="bg-card overflow-x-auto rounded-lg border p-4">
      <div className="grid min-w-[680px] grid-cols-[150px_minmax(500px,1fr)] items-center gap-x-4 gap-y-2">
        <div />
        <div className="text-muted-foreground relative h-4 font-mono text-[11px]">
          {ticks.map((tick) => (
            <span key={tick.label} className="absolute -translate-x-1/2" style={{ left: `${tick.at}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
        {children}
      </div>
    </div>
  )
}

const REVIEW_VARIANT = { accepted: 'success', rejected: 'danger', open: 'secondary' } as const

export function ReviewBadge({ state, label }: { state: ReviewState; label: string }): JSX.Element {
  return <Badge variant={REVIEW_VARIANT[state]}>{label}</Badge>
}

/** A fact of a statement: its label, then what it says. */
export function StatementFact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-1 border-t px-5 py-3 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className="min-w-0 text-sm break-words">{children}</div>
    </div>
  )
}

/** The statement itself, as one sentence over its facts. */
export function StatementCard({ says, children, footer }: { says: ReactNode; children: ReactNode; footer?: ReactNode }): JSX.Element {
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <p className="px-5 py-4 text-base leading-relaxed">{says}</p>
      {children}
      {footer ? <div className="bg-muted flex flex-wrap items-center gap-2 border-t px-5 py-3">{footer}</div> : null}
    </div>
  )
}

/** A quoted passage from the source, with its link. */
export function SourceQuote({ url, quote, note }: { url: string; quote: string | null; note: string | null }): JSX.Element {
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    // keep the address as given
  }
  return (
    <div className="border-source-law bg-source-law-tint text-source-law-text rounded-r-md border-l-[3px] px-3 py-2">
      {quote ? <q className="block">{quote}</q> : null}
      <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {host}
      </a>
      {note ? <span className="text-muted-foreground"> · {note}</span> : null}
    </div>
  )
}
