'use client'

import type { FC } from 'react'

import { formatElapsed } from '@/features/chat/hooks/use-elapsed-seconds'
import { useTranslations } from '@/i18n'
import { runsCopy } from '@/i18n/namespaces/runs'
import type { RunLedger } from '@/lib/runs/run-ledger-types'
import { elapsedMs } from '@/lib/runs/run-vocabulary'
import { useRunClock } from '../../hooks/use-run-clock'

export const RunElapsed: FC<{ ledger: RunLedger; live: boolean }> = ({ ledger, live }) => {
  const t = useTranslations(runsCopy)
  const now = useRunClock(live)
  const elapsedSeconds =
    ledger.finishedAt || now !== null ? Math.floor(elapsedMs(ledger, now ?? 0) / 1000) : 0
  if (elapsedSeconds <= 0) return null
  const elapsed = formatElapsed(elapsedSeconds)
  return (
    <span
      className="text-muted-foreground text-xs tabular-nums"
      aria-label={t('block.elapsedAria', { elapsed })}
      data-testid="run-elapsed"
    >
      {elapsed}
    </span>
  )
}
