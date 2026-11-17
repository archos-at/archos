'use client'

import type { JSX, ReactNode } from 'react'
import {
  ArrowUp,
  Ban,
  Check,
  CircleAlert,
  CircleDashed,
  CircleHelp,
  Clock,
  ScanText,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react'
import type { SurfaceState } from '@/lib/documents/surface-state'
import { cn } from '@/lib/utils'
import type { UploadPhase } from '../lib/upload-progress'

export type IngestionMark = SurfaceState | 'queued' | 'canceled'

export const INGESTION_GLYPH: Record<IngestionMark, LucideIcon> = {
  queued: Clock,
  uploading: ArrowUp,
  reading: ScanText,
  citable: Check,
  held: ShieldAlert,
  unreadable: CircleAlert,
  stored: CircleDashed,
  unknown: CircleHelp,
  cancelled: Ban,
  canceled: Ban,
}

export function ingestionMarkOfPhase(phase: UploadPhase): IngestionMark {
  switch (phase) {
    case 'queued':
      return 'queued'
    case 'uploading':
      return 'uploading'
    case 'processing':
      return 'reading'
    case 'ready':
      return 'citable'
    case 'held':
      return 'held'
    case 'stored':
      return 'stored'
    case 'failed':
      return 'unreadable'
    case 'canceled':
      return 'canceled'
  }
}

const WORD_TONE: Record<IngestionMark, string> = {
  queued: 'text-muted-foreground',
  uploading: 'text-muted-foreground',
  reading: 'text-muted-foreground',
  citable: 'text-success',
  held: 'text-warning',
  unreadable: 'text-error',
  stored: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
  canceled: 'text-muted-foreground',
}

export function IngestionGlyph({ mark, className }: { mark: IngestionMark; className?: string }): JSX.Element {
  const Glyph = INGESTION_GLYPH[mark]
  return <Glyph data-mark={mark} className={cn('size-3.5 shrink-0', className)} aria-hidden />
}

export function IngestionStatusWord({
  mark,
  quiet = false,
  className,
  children,
}: {
  mark: IngestionMark
  quiet?: boolean
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <span
      data-mark={mark}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 whitespace-nowrap',
        quiet ? 'text-muted-foreground' : WORD_TONE[mark],
        className
      )}
    >
      <IngestionGlyph mark={mark} />
      {children}
    </span>
  )
}
