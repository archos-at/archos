'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import { Boxes, Layers3, Ruler, ScrollText, Square } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { cn } from '@/lib/utils'
import { useDocumentBimModel, useProjectBimModels } from '../hooks/use-bim-model'
import { formatMeasure } from '../lib/format-value'

interface IfcFileFactsProps {
  documentId: string
  projectId?: string | null
  className?: string
}

export function IfcFileFacts({ documentId, projectId, className }: IfcFileFactsProps): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const { data: models } = useProjectBimModels(projectId ?? null)
  const { data: documentModel } = useDocumentBimModel(projectId ? null : documentId)

  const model = useMemo(
    () =>
      projectId
        ? (models?.find((candidate) => candidate.documentId === documentId) ?? null)
        : documentModel,
    [projectId, models, documentModel, documentId]
  )
  const summary = model?.status === 'ready' ? model.summary : null

  const rows = useMemo(() => {
    if (!summary) return []
    const areaUnit = summary.units.area?.symbol ?? 'm²'
    const count = (value: number): string => value.toLocaleString(locale)
    const entries: Array<{ label: string; value: string; icon: LucideIcon }> = [
      { label: t('overview.storeys'), value: count(summary.totals.storeys), icon: Layers3 },
      { label: t('overview.elements'), value: count(summary.totals.elements), icon: Boxes },
      { label: t('overview.spaces'), value: count(summary.totals.spaces), icon: Square },
    ]
    if (summary.quantityTotals.netFloorAreaM2 !== null) {
      entries.push({
        label: t('overview.netFloorArea'),
        value: formatMeasure(summary.quantityTotals.netFloorAreaM2, areaUnit, locale),
        icon: Ruler,
      })
    }
    if (summary.schema) {
      entries.push({ label: t('overview.schema'), value: summary.schema, icon: ScrollText })
    }
    return entries
  }, [summary, t, locale])

  if (rows.length === 0) return null

  return (
    <section className={cn('space-y-3', className)} aria-label={t('facts.title')}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Boxes className="size-3.5 shrink-0" aria-hidden />
        {t('facts.title')}
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3">
            <span className="flex shrink-0 items-center gap-1.5 pt-px text-xs text-muted-foreground">
              <row.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {row.label}
            </span>
            <span className="min-w-0 text-right text-xs font-medium tabular-nums text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('facts.caption')}</p>
    </section>
  )
}

export default IfcFileFacts
