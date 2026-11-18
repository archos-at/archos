'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import { Brush } from 'lucide-react'
import {
  MaintenanceActionCard,
  type MaintenanceActionCopy,
  type MaintenanceFailure,
  type MaintenanceMeasure,
  type MaintenanceOutcome,
} from '@/features/platform/components/maintenance-action-card'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'

export interface ReconcileResult {
  collectionsScanned: number
  orphansFound: number
  orphansDeleted: number
  summariesForgotten: number
  failures: { collectionName: string; error: string }[]
}

const RECONCILE_TIMEOUT_MS = 120_000

function parseReconcile(body: unknown): ReconcileResult {
  const raw = (body ?? {}) as Partial<ReconcileResult>
  return {
    collectionsScanned: raw.collectionsScanned ?? 0,
    orphansFound: raw.orphansFound ?? 0,
    orphansDeleted: raw.orphansDeleted ?? 0,
    summariesForgotten: raw.summariesForgotten ?? 0,
    failures: raw.failures ?? [],
  }
}

export interface VectorMaintenanceProps {
  initialResult?: ReconcileResult | null
}

export function VectorMaintenance({ initialResult = null }: VectorMaintenanceProps): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()

  const copy = useMemo<MaintenanceActionCopy>(
    () => ({
      title: t('vectorMaintenance.title'),
      description: t('vectorMaintenance.description'),
      run: t('vectorMaintenance.run'),
      running: t('vectorMaintenance.running'),
      explainers: [
        { key: 'how', term: t('vectorMaintenance.howTitle'), body: t('vectorMaintenance.howBody') },
        {
          key: 'when',
          term: t('vectorMaintenance.whenTitle'),
          body: t('vectorMaintenance.whenBody'),
        },
        {
          key: 'scope',
          term: t('vectorMaintenance.scopeTitle'),
          body: t('vectorMaintenance.scopeBody'),
        },
      ],
      lastRunTitle: t('vectorMaintenance.lastRunTitle'),
      lastRunHint: t('vectorMaintenance.lastRunHint'),
      neverRunTitle: t('vectorMaintenance.neverRunTitle'),
      neverRunBody: t('vectorMaintenance.neverRunBody'),
      confirmTitle: t('vectorMaintenance.confirmTitle'),
      confirmDescription: t('vectorMaintenance.confirmDescription'),
      confirmWarning: t('vectorMaintenance.confirmWarning'),
      confirmCta: t('vectorMaintenance.confirmCta'),
      cancel: t('vectorMaintenance.cancel'),
      failed: t('vectorMaintenance.failed'),
      failedHint: t('vectorMaintenance.failedHint'),
      colMeasure: t('vectorMaintenance.colMeasure'),
      colCount: t('vectorMaintenance.colCount'),
      failuresTitle: (count) => t('vectorMaintenance.failuresTitle', { count }),
      failuresHint: t('vectorMaintenance.failuresHint'),
      colFailureId: t('vectorMaintenance.colCollection'),
      colFailureError: t('vectorMaintenance.colError'),
      readOnly: t('vectorMaintenance.readOnly'),
    }),
    [t]
  )

  const outcome = useMemo(
    () =>
      (result: ReconcileResult): MaintenanceOutcome => ({
        changed: result.orphansDeleted > 0,
        title:
          result.orphansDeleted > 0
            ? t('vectorMaintenance.outcomeRemoved', {
                chunks: result.orphansDeleted.toLocaleString(locale),
                collections: result.collectionsScanned.toLocaleString(locale),
              })
            : t('vectorMaintenance.outcomeClean'),
      }),
    [locale, t]
  )

  const measures = useMemo(
    () =>
      (result: ReconcileResult): MaintenanceMeasure[] => [
        {
          key: 'collections',
          label: t('vectorMaintenance.measureCollections'),
          hint: t('vectorMaintenance.measureCollectionsHint'),
          value: result.collectionsScanned,
        },
        {
          key: 'found',
          label: t('vectorMaintenance.measureFound'),
          hint: t('vectorMaintenance.measureFoundHint'),
          value: result.orphansFound,
        },
        {
          key: 'deleted',
          label: t('vectorMaintenance.measureDeleted'),
          hint: t('vectorMaintenance.measureDeletedHint'),
          value: result.orphansDeleted,
        },
        {
          key: 'summaries',
          label: t('vectorMaintenance.measureSummaries'),
          hint: t('vectorMaintenance.measureSummariesHint'),
          value: result.summariesForgotten,
        },
      ],
    [t]
  )

  return (
    <MaintenanceActionCard
      copy={copy}
      icon={Brush}
      endpoint="/api/platform/maintenance/reconcile-vectors"
      timeoutMs={RECONCILE_TIMEOUT_MS}
      parse={parseReconcile}
      outcome={outcome}
      measures={measures}
      failures={reconcileFailures}
      initialResult={initialResult}
      testId="vector-maintenance"
      idPrefix="reconcile"
    />
  )
}

function reconcileFailures(result: ReconcileResult): MaintenanceFailure[] {
  return result.failures.map((failure) => ({ id: failure.collectionName, error: failure.error }))
}
