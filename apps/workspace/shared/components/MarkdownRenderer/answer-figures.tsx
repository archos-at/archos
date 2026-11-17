'use client'

import { type FC, type ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'
import type { StatusTone } from './status-marks'

export type FigureTone = StatusTone | 'none'

const FIGURE_INK: Record<FigureTone, string> = {
  success: 'text-success',
  destructive: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
  muted: 'text-foreground',
  none: 'text-foreground',
}

const FIGURE_SWATCH: Record<FigureTone, string> = {
  success: 'bg-success',
  destructive: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  muted: 'bg-muted-foreground',
  none: '',
}

export const FigureGrid: FC<{ count: number; children: ReactNode }> = ({ count, children }) => (
  <div className="my-4 @container break-inside-avoid">
    <div
      data-testid="figure-grid"
      data-count={count}
      className={cn(
        'grid gap-2',
        count <= 1 && 'grid-cols-1 @[28rem]:max-w-[50%]',
        count === 2 && 'grid-cols-2',
        count === 3 && 'grid-cols-1 @[26rem]:grid-cols-3',
        count >= 4 && 'grid-cols-2 @[44rem]:grid-cols-4'
      )}
    >
      {children}
    </div>
  </div>
)

export const FigureTile: FC<{
  tone: FigureTone
  value: ReactNode
  label: ReactNode
  limit?: ReactNode
  verdict?: string
}> = ({ tone, value, label, limit, verdict }) => {
  const t = useTranslations(commonCopy)
  return (
    <div data-testid="figure-tile" data-tone={tone} className="flex min-w-0 flex-col gap-1 rounded-surface bg-muted/40 px-3.5 py-3">
      <span className={cn('card-figure-24 break-words', FIGURE_INK[tone])}>{value}</span>
      <span className="card-caption flex items-baseline gap-1.5 text-default">
        {tone !== 'none' && <span aria-hidden="true" className={cn('size-2.5 shrink-0 translate-y-px rounded-[3px]', FIGURE_SWATCH[tone])} />}
        <span className="min-w-0">{label}</span>
      </span>
      {(limit || verdict) && (
        <span className="card-meta text-muted-foreground">
          {limit && (
            <>
              {t('markdown.figureLimit')} {limit}
            </>
          )}
          {limit && verdict && ' · '}
          {verdict}
        </span>
      )}
    </div>
  )
}
