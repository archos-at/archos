'use client'

import type { FC } from 'react'

import { useLocale, useTranslations } from '@/i18n'
import { runsCopy } from '@/i18n/namespaces/runs'
import { formatDurationElapsed } from '@/lib/format'
import { RUN_PHASES, type RunLedger } from '@/lib/runs/run-ledger-types'
import {
  phaseDurationMs,
  phaseState,
  stepsInPhase,
  type RunTallies,
} from '@/lib/runs/run-vocabulary'
import { useRunClock } from '../../hooks/use-run-clock'
import { doneLine, liveLine } from '../../lib/run-status-lines'
import { Sep } from './run-separator'

export const PhaseActs: FC<{
  ledger: RunLedger
  live: boolean
  tallies: RunTallies
}> = ({ ledger, live, tallies }) => {
  const t = useTranslations(runsCopy)
  const now = useRunClock(live)
  const { locale } = useLocale()
  const rows = RUN_PHASES.flatMap((phase) => {
    const state = phaseState(ledger, phase)
    if (state === 'pending') return []
    if (phase === 'researching' && stepsInPhase(ledger, phase).length > 0) return []
    if (state === 'active') {
      const line = live ? liveLine(t, phase) : null
      return line ? [{ phase, line, duration: null as number | null }] : []
    }
    const line = doneLine(t, phase, tallies)
    const duration = phaseDurationMs(ledger, phase, now ?? 0)
    if (!line && duration === null) return []
    return [{ phase, line, duration }]
  })
  if (rows.length === 0) return null
  return (
    <dl
      className="border-border flex flex-col gap-0.5 border-t px-3 py-2"
      data-testid="run-phase-acts"
    >
      {rows.map(({ phase, line, duration }) => (
        <div
          key={phase}
          className="text-muted-foreground flex gap-1.5 text-xs"
          data-phase={phase}
        >
          <dt className="shrink-0 font-medium">{t(`phase.${phase}`)}</dt>
          <dd className="min-w-0 break-words">
            {line}
            {duration !== null && (
              <>
                {line && <Sep />}
                <span className="whitespace-nowrap tabular-nums">
                  {formatDurationElapsed(duration / 1000, locale)}
                </span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
