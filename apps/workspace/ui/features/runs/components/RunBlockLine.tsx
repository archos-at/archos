'use client'

import type { JSX } from 'react'
import type { FC } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { runsCopy } from '@/i18n/namespaces/runs'
import type { RunLedger, RunStatus } from '@/lib/runs/run-ledger-types'
import { runDisplayStatus, runTallies, type RunTallies } from '@/lib/runs/run-vocabulary'
import { cn } from '@/lib/utils'
import { RunStatusGlyph } from './RunStatusGlyph'

export interface RunBlockLineProps {
  ledger: RunLedger | null
  status?: RunStatus
  tallies?: RunTallies
  title?: string
  href?: string
  at?: string | Date
  className?: string
}

const Sep: FC = () => (
  <span aria-hidden className="text-muted-foreground/50 whitespace-pre">
    {' · '}
  </span>
)

export function RunBlockLine({
  ledger,
  status,
  tallies: givenTallies,
  title,
  href,
  at,
  className,
}: RunBlockLineProps): JSX.Element {
  const t = useTranslations(runsCopy)
  const { locale } = useLocale()
  const shown: RunStatus = status ?? (ledger ? runDisplayStatus(ledger) : 'created')
  const statusWord = t(`status.${shown}`)
  const tallies =
    givenTallies ?? (ledger ? runTallies(ledger) : { rounds: 0, docs: 0, findings: 0 })
  const atIso = at instanceof Date ? at.toISOString() : at

  return (
    <div
      data-testid="run-block-line"
      data-status={shown}
      className={cn('flex min-h-11 min-w-0 items-center gap-2 text-sm', className)}
    >
      {/* Decorative: the status word is the very next thing in the row. */}
      <RunStatusGlyph status={shown} size="sm" />
      {/* The title is the one clause that gives way; the word, the tallies and
          the time are short facts and stay whole, because a row that reads
          „vor 1…" has lost the thing the time was there for. The tallies step
          aside on a phone, where the title needs the width more. */}
      <span className="flex min-w-0 flex-1 items-baseline overflow-hidden">
        <span className="text-foreground shrink-0 font-medium" data-testid="run-line-status">
          {statusWord}
        </span>
        {title && (
          <>
            <Sep />
            <span className="text-foreground min-w-0 truncate">{title}</span>
          </>
        )}
        {(tallies.rounds > 0 || tallies.docs > 0) && (
          <span className="text-muted-foreground hidden shrink-0 sm:inline">
            <Sep />
            {[
              tallies.rounds > 0 ? t('tallies.rounds', { count: tallies.rounds }) : null,
              tallies.docs > 0 ? t('tallies.docs', { count: tallies.docs }) : null,
              (tallies.findings ?? 0) > 0
                ? t('tallies.findings', { count: tallies.findings ?? 0 })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {atIso && (
          <span className="text-muted-foreground shrink-0">
            <Sep />
            <TimeAgo date={atIso} locale={locale} />
          </span>
        )}
      </span>
      {/* On a phone the word, the time and a text link do not fit beside a
          title, so the link is its arrow alone there and the text is its
          accessible name; the 44px floor keeps the arrow pressable. */}
      {href && (
        <Link
          href={href}
          aria-label={t('action.openInThread')}
          className="text-primary pointer-coarse:min-h-11 pointer-coarse:min-w-11 ml-auto inline-flex shrink-0 items-center justify-center gap-1 rounded-md text-xs font-medium hover:underline"
          data-testid="run-line-open"
        >
          <span className="hidden sm:inline">{t('action.openInThread')}</span>
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </div>
  )
}
