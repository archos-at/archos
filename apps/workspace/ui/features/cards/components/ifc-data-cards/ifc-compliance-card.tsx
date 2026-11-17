'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight, Download, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { canonicalBimRuleId, rulesWithOpenWork, type BimRuleResult } from '@/lib/bim/rules'
import { buildModelHref } from '@/features/bim/lib/model-link'
import { useProjectRuleFacts } from '@/features/bim/hooks/use-bim-model'
import { useModelQuery } from '../../hooks/use-model-query'
import { useResolvedModel } from '../../hooks/use-resolved-model'
import { CardShell } from './card-shell'
import { NoModel } from './no-model'

const pickCompliance = (payload: Record<string, unknown>) =>
  payload.compliance
    ? {
        rules: payload.compliance as BimRuleResult[],
        truncated: payload.truncated === true,
      }
    : undefined

export interface IfcComplianceCardProps {
  title: string
  modelFile: string | null
  ruleIds: string[]
  note: string | null
  projectId: string | null
}

export function IfcComplianceCard({
  title,
  modelFile,
  ruleIds,
  note,
  projectId,
}: IfcComplianceCardProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const {
    model,
    isLoading: modelsLoading,
    error: modelsError,
    ambiguous,
    notReady,
  } = useResolvedModel(projectId, modelFile)
  const facts = useProjectRuleFacts(projectId)
  const request = useMemo(
    () => ({
      op: 'compliance' as const,
      ...(facts.buildingClass === null ? {} : { buildingClass: facts.buildingClass }),
      ...(facts.mainUse === null ? {} : { mainUse: facts.mainUse }),
    }),
    [facts.buildingClass, facts.mainUse]
  )
  const query = useModelQuery(facts.ready ? (model?.id ?? null) : null, request, pickCompliance)
  const { data: run, isLoading: queryLoading, error } = query
  const rules = run?.rules ?? null
  const isLoading = queryLoading || !facts.ready

  const selected = useMemo(() => {
    if (!rules) return null
    if (ruleIds.length === 0) return rules
    const wanted = new Set(ruleIds.map(canonicalBimRuleId))
    return rules.filter((rule) => wanted.has(rule.ruleId))
  }, [rules, ruleIds])

  const unresolved = useMemo(() => {
    if (!rules || ruleIds.length === 0) return 0
    const known = new Set(rules.map((rule) => rule.ruleId))
    return ruleIds.filter((id) => !known.has(canonicalBimRuleId(id))).length
  }, [rules, ruleIds])

  const bcfHref = useMemo(() => {
    if (!model || !projectId || !selected || rulesWithOpenWork(selected).length === 0) return null
    const query = new URLSearchParams({ modelId: model.id })
    if (facts.buildingClass !== null) query.set('buildingClass', String(facts.buildingClass))
    if (facts.mainUse !== null) query.set('mainUse', facts.mainUse)
    return `/api/projects/${projectId}/bim/checks/export?${query.toString()}`
  }, [model, projectId, selected, facts.buildingClass, facts.mainUse])

  return (
    <CardShell
      title={title}
      icon={ShieldCheck}
      action={
        model && projectId ? (
          <div className="flex flex-wrap items-center gap-1">
            {bcfHref && (
              <Button asChild size="sm" variant="ghost">
                <a href={bcfHref} download>
                  <Download className="size-3.5" aria-hidden="true" />
                  {t('compliance.card.export')}
                </a>
              </Button>
            )}
            <Button asChild size="sm" variant="ghost">
              <Link href={buildModelHref(projectId, { model: model.filename, tab: 'compliance' })}>
                {t('card.openModel')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        ) : null
      }
    >
      {!model ? (
        <NoModel isLoading={modelsLoading} error={modelsError} ambiguous={ambiguous} notReady={notReady} />
      ) : isLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <p className="text-sm text-destructive">{t('compliance.failed')}</p>
      ) : (
        <div className="space-y-2">
          {/* Above the verdicts, because it is what they are worth. */}
          {run?.truncated && (
            <p className="text-xs text-destructive">{t('compliance.truncatedModel')}</p>
          )}
          {unresolved > 0 && (
            <p className="text-xs text-warning">
              {unresolved === 1
                ? t('compliance.card.unresolvedOne')
                : t('compliance.card.unresolved', { count: unresolved })}
            </p>
          )}
          {selected?.length === 0 ? (
            <EmptyState title={t('compliance.card.none')} />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {(selected ?? []).map((rule) => (
                <li key={rule.ruleId} className="space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{rule.titleDe}</span>
                    <span className="text-xs text-muted-foreground">
                      {rule.richtlinie}, Punkt {rule.clause}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {/* A hint, from the records, is said as is: its counts would read as missing data. */}
                    {!rule.applicable
                      ? `${t('compliance.notApplicable')}: ${rule.notApplicableReason ?? ''}`
                      : (rule.hint ??
                        t('compliance.counts', {
                          passed: rule.passed,
                          failed: rule.failed,
                          undecidable: rule.undecidable,
                        }))}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {/* Non-negotiable on a surface that leaves the page in a screenshot. */}
          <p className="text-xs text-muted-foreground">{t('compliance.disclaimer')}</p>
        </div>
      )}
    </CardShell>
  )
}
