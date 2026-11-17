'use client'

import type { JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import type { TextSegment } from '@/lib/text/term-segments'
import { cn } from '@/lib/utils'
import { leadUpToMatch } from '../lib/passage-window'
import { MatchedSegments } from './match-mark'

export const PALETTE_HIT_CLASS = 'py-2 [&_svg.size-3]:size-3! pointer-coarse:min-h-11'

export const PALETTE_STALE_CLASS = '[&_[cmdk-group-heading]]:opacity-70 [&_[cmdk-item]:not([data-selected=true])]:opacity-70'

export function PaletteEmpty({ title, hint, testId }: { title: ReactNode; hint?: ReactNode; testId?: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1 px-3 pt-4 pb-3" aria-live="polite">
      <p className="text-sm font-medium text-foreground" data-testid={testId}>
        {title}
      </p>
      {hint ? <p className="text-pretty text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function PaletteScopeLine({ project, dimmed = false }: { project: string; dimmed?: boolean }): JSX.Element {
  const t = useTranslations(searchCopy)
  return (
    <p
      className={cn(
        'flex min-w-0 items-center gap-1.5 px-3 pt-2.5 pb-1.5 text-xs text-muted-foreground',
        dimmed && 'opacity-70'
      )}
      data-testid="palette-scope-line"
    >
      <span className="truncate">{t('palette.allIn', { project })}</span>
    </p>
  )
}

export function PaletteGroupHeading({ children, count }: { children: ReactNode; count: string | null }): JSX.Element {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span>{children}</span>
      {count ? <span className="tabular-nums text-muted-foreground/80">{count}</span> : null}
    </span>
  )
}

export function PaletteHitsSkeleton(): JSX.Element {
  const groups = [3, 1, 1]
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="palette-skeleton" aria-hidden>
      {groups.map((rows, group) => (
        <div key={group} className={cn('flex flex-col p-1', group === groups.length - 1 && 'flex-1')}>
          <Skeleton className="mx-2 mt-1.5 mb-2.5 h-3 w-20" />
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-start gap-3 px-2 py-2">
              <Skeleton className="mt-0.5 size-4" />
              <div className="flex flex-1 flex-col gap-2 pt-0.5">
                <Skeleton className={cn('h-3.5', ['w-1/2', 'w-2/5', 'w-1/3'][(index + group) % 3])} />
                <Skeleton className={cn('h-3', ['w-3/4', 'w-3/5', 'w-2/3'][(index + group) % 3])} />
                {/* A document found by what it says has a third line, its passage. */}
                {group === 0 && index < 2 ? <Skeleton className={cn('h-3', ['w-2/3', 'w-1/2'][index])} /> : null}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function PaletteGlyph({ icon: Icon, top = false }: { icon: LucideIcon; top?: boolean }): JSX.Element {
  return <Icon className={cn('text-muted-foreground', top && 'mt-0.5 self-start')} aria-hidden />
}

export function PaletteLabel({ children, hint, hintTestId }: { children: ReactNode; hint?: ReactNode; hintTestId?: string }): JSX.Element {
  if (!hint) return <span className="min-w-0 flex-1 truncate">{children}</span>
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate">{children}</span>
      <span className="text-pretty text-xs text-muted-foreground" data-testid={hintTestId}>
        {hint}
      </span>
    </span>
  )
}

export function PaletteAside({ children, busy = false, testId }: { children: ReactNode; busy?: boolean; testId?: string }): JSX.Element {
  return (
    <span className="ml-auto flex min-w-0 max-w-[45%] items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite" data-testid={testId}>
      {busy ? <Spinner className="size-3 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  )
}

export function PaletteStatusLine({ children, busy = false, testId }: { children: ReactNode; busy?: boolean; testId?: string }): JSX.Element {
  return (
    <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground" aria-live="polite" data-testid={testId}>
      {busy ? <Spinner className="size-3" /> : null}
      {children}
    </p>
  )
}

export function CompactPassage({ segments, page }: { segments: readonly TextSegment[]; page?: string }): JSX.Element {
  const shown = leadUpToMatch(segments)
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-xs leading-5 text-muted-foreground" data-testid="search-passage">
      {page ? <span className="shrink-0 font-medium tabular-nums text-foreground/70">{page}</span> : null}
      <span className="min-w-0 truncate">
        {shown === segments ? '„' : '„…'}
        <MatchedSegments segments={shown} testId="search-passage-match" />“
      </span>
    </span>
  )
}

export function CompactMatchHint({ label, parts, testId }: { label: string; parts: readonly string[]; testId: string }): JSX.Element {
  return (
    <span className="flex min-w-0 items-baseline gap-1 text-xs leading-5 text-muted-foreground" data-testid={testId}>
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground/70">{parts.join(' · ')}</span>
    </span>
  )
}
