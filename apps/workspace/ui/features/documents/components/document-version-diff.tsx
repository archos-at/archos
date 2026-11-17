'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations, type Translator } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { DIFF_MAX_ROWS, diffVersionText, type DiffRow } from '@/lib/documents/version-diff'

export interface DocumentVersionDiffProps {
  from: { versionNumber: number; content: string }
  to: { versionNumber: number; content: string }
  className?: string
}

const ROW_STYLES = {
  added: 'bg-accent text-foreground',
  removed: 'bg-surface-sunken text-muted-foreground',
  context: 'text-muted-foreground',
} as const satisfies Record<'added' | 'removed' | 'context', string>

const MARKERS = { added: '+', removed: '−', context: ' ' } as const

export function DocumentVersionDiff({ from, to, className }: DocumentVersionDiffProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const diff = useMemo(() => diffVersionText(from.content, to.content), [from.content, to.content])

  return (
    <section className={cn('space-y-1.5', className)} data-testid="document-version-diff">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <SectionLabel as="h4">{t('lifecycle.versions.diff.heading')}</SectionLabel>
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {t('lifecycle.versions.diff.between', {
            from: from.versionNumber,
            to: to.versionNumber,
          })}
        </span>
        <span className="flex-1" />
        {!diff.identical && (
          <span
            className="text-muted-foreground text-[11px] tabular-nums"
            data-testid="document-version-diff-counts"
          >
            {t('lifecycle.versions.diff.added', { count: diff.added })} ·{' '}
            {t('lifecycle.versions.diff.removed', { count: diff.removed })}
          </span>
        )}
      </div>

      {diff.identical ? (
        <p className="text-muted-foreground text-[11px]" data-testid="document-version-diff-identical">
          {t('lifecycle.versions.diff.identical')}
        </p>
      ) : (
        <ol
          className="bg-card max-h-80 overflow-auto rounded-surface border py-1 font-mono text-[11px] leading-[1.6] pointer-coarse:text-[13px]"
          data-testid="document-version-diff-rows"
        >
          {diff.rows.map((row, index) => (
            <DiffRowItem key={index} row={row} t={t} />
          ))}
        </ol>
      )}

      {diff.truncated && (
        <p className="text-muted-foreground text-[11px]" data-testid="document-version-diff-truncated">
          {t('lifecycle.versions.diff.truncated', { count: DIFF_MAX_ROWS })}
        </p>
      )}
    </section>
  )
}

function DiffRowItem({ row, t }: { row: DiffRow; t: Translator }): JSX.Element {
  if (row.kind === 'gap') {
    return (
      <li
        className="text-muted-foreground flex items-center gap-2 px-2 py-1 select-none"
        data-testid="document-version-diff-gap"
      >
        <span aria-hidden className="border-border flex-1 border-t border-dashed" />
        <span className="shrink-0 text-[10px] tabular-nums">
          {t('lifecycle.versions.diff.gap', { count: row.skipped })}
        </span>
        <span aria-hidden className="border-border flex-1 border-t border-dashed" />
      </li>
    )
  }

  const changed = row.kind !== 'context'
  return (
    <li
      className={cn('flex min-w-0 gap-2 px-2', ROW_STYLES[row.kind])}
      data-testid="document-version-diff-row"
      data-kind={row.kind}
    >
      {/* Both line numbers, so an insert visibly pushes one column past the
          other. Hidden on a phone, where the text needs the width more. */}
      <span aria-hidden className="text-muted-foreground/50 hidden w-14 shrink-0 tabular-nums sm:inline-block">
        <span className="inline-block w-6 text-right">{row.fromLine ?? ''}</span>
        <span className="inline-block w-8 text-right">{row.toLine ?? ''}</span>
      </span>
      <span aria-hidden className="w-2 shrink-0 select-none">
        {MARKERS[row.kind]}
      </span>
      {changed && (
        <span className="sr-only">
          {t(`lifecycle.versions.diff.${row.kind === 'added' ? 'addedLine' : 'removedLine'}`)}:{' '}
        </span>
      )}
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{row.text || ' '}</span>
    </li>
  )
}
