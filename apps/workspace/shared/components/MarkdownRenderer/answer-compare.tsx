'use client'

import { type FC, type ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'
import { MarkChip } from './answer-chips'

export const CompareStackFrame: FC<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="compare-stack" className="my-4 hidden flex-col gap-2 @max-[30rem]/compare:flex">
    {children}
  </div>
)

export const CompareVariantCard: FC<{ recommended: boolean; children: ReactNode }> = ({ recommended, children }) => (
  <section
    data-recommended={recommended ? 'true' : undefined}
    className={cn('flex flex-col gap-1.5 rounded-surface px-3.5 py-3', recommended ? 'bg-card shadow-xs ring-1 ring-border' : 'bg-muted/40')}
  >
    {children}
  </section>
)

export const CompareVariantTitle: FC<{ recommended: boolean; children: ReactNode }> = ({ recommended, children }) => {
  const t = useTranslations(commonCopy)
  return (
    <p className="card-title text-foreground">
      {children}
      {recommended && <MarkChip>{t('markdown.recommended')}</MarkChip>}
    </p>
  )
}

export const CompareVariantRow: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-[38%_minmax(0,1fr)] items-baseline gap-3 text-sm">{children}</div>
)

export const CompareVariantLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="card-caption text-muted-foreground">{children}</span>
)

export const CompareVariantValue: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="min-w-0 text-foreground">{children}</span>
)
