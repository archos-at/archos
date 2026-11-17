'use client'

import type { JSX } from 'react'
import { ArrowRight, GitCompare, TrendingDown, TrendingUp, HelpCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { BimComplianceChange, BimComplianceTrend } from '@/lib/bim/rules'
import type { BimModelHeaderView } from '../hooks/use-bim-model'

export interface IfcComplianceDiffProps {
  baseModel: BimModelHeaderView | null
  changes: BimComplianceChange[] | null
  truncated?: boolean
  isLoading: boolean
  error: string | null
  onRun: () => void
}

const TREND_STYLE: Record<
  BimComplianceTrend,
  { variant: 'destructive' | 'warning' | 'success' | 'secondary'; Icon: typeof TrendingDown }
> = {
  broken: { variant: 'destructive', Icon: TrendingDown },
  undecidable: { variant: 'warning', Icon: HelpCircle },
  moved: { variant: 'warning', Icon: ArrowRight },
  decidable: { variant: 'success', Icon: TrendingUp },
  resolved: { variant: 'success', Icon: TrendingUp },
}

export function IfcComplianceDiff({
  baseModel,
  changes,
  truncated = false,
  isLoading,
  error,
  onRun,
}: IfcComplianceDiffProps): JSX.Element | null {
  const t = useTranslations(bimCopy)
  if (!baseModel) return null

  return (
    <section aria-labelledby="bim-compliance-diff-heading" className="space-y-2">
      <h2
        id="bim-compliance-diff-heading"
        className="flex items-center gap-2 text-sm font-medium"
      >
        <GitCompare className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('complianceDiff.title')}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t('complianceDiff.description', { previous: baseModel.filename })}
      </p>

      <Button type="button" size="sm" variant="secondary" onClick={onRun} disabled={isLoading}>
        {isLoading ? <Spinner className="size-3" /> : null}
        {isLoading ? t('complianceDiff.running') : t('complianceDiff.run')}
      </Button>

      {error && <p className="text-sm text-destructive">{t('complianceDiff.failed')}</p>}

      {/* Before the result, because it is what the result is worth. */}
      {changes && truncated && (
        <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <TrendingDown className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('complianceDiff.truncated')}
        </p>
      )}

      {changes && changes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('complianceDiff.unchanged')}</p>
      )}

      {changes && changes.length > 0 && (
        <ul className="space-y-2">
          {changes.map((change) => {
            const { variant, Icon } = TREND_STYLE[change.trend]
            return (
              <li key={change.ruleId} className="rounded-lg border p-2.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{change.titleDe}</span>
                  <span className="text-xs text-muted-foreground">{change.richtlinie}</span>
                  <Badge variant={variant}>{t(`complianceDiff.trend.${change.trend}`)}</Badge>
                </p>
                {/* Both sides, always: "broken" without the numbers is a claim,
                    with them it is evidence. */}
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {t('complianceDiff.counts', {
                    beforePassed: change.before.passed,
                    beforeFailed: change.before.failed,
                    beforeUndecidable: change.before.undecidable,
                    afterPassed: change.after.passed,
                    afterFailed: change.after.failed,
                    afterUndecidable: change.after.undecidable,
                  })}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
