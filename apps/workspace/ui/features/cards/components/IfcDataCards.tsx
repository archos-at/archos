'use client'

import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Boxes, Download, GitCompare, ShieldCheck, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { BimComparison } from '@/lib/bim/compare'
import { canonicalBimRuleId, rulesWithOpenWork, type BimRuleResult } from '@/lib/bim/rules'
import { roomScheduleToCsv, type BimRoomSchedule } from '@/lib/bim/schedule'
import { buildModelHref } from '@/features/bim/lib/model-link'
import { formatPropertyValue } from '@/features/bim/lib/format-value'
import { shortIfcType } from '@/features/bim/lib/model-index'
import { capturePosthog } from '@/lib/analytics/posthog'
import {
  notReadyModelStatus,
  resolveModelByFilename,
  useProjectBimModels,
  useProjectRuleFacts,
  type BimElementDetail,
  type BimModelHeaderView,
} from '@/features/bim/hooks/use-bim-model'

function useResolvedModel(
  projectId: string | null,
  modelFile: string | null
): {
  model: BimModelHeaderView | null
  models: BimModelHeaderView[]
  isLoading: boolean
  error: string | null
  ambiguous: boolean
  notReady: 'extracting' | 'failed' | null
} {
  const { data, isLoading, error } = useProjectBimModels(projectId)
  const models = useMemo(
    () => (data ?? []).filter((candidate) => candidate.status === 'ready'),
    [data]
  )
  const { model, ambiguous } = useMemo(
    () => resolveModelByFilename(models, modelFile),
    [models, modelFile]
  )
  const notReady = useMemo(
    () => (model ? null : notReadyModelStatus(data ?? [], modelFile)),
    [model, data, modelFile]
  )
  return { model, models, isLoading: isLoading && data === null, error, ambiguous, notReady }
}

function useModelQuery<T>(
  modelId: string | null,
  body: Record<string, unknown> | null,
  pick: (payload: Record<string, unknown>) => T | undefined
): { data: T | null; isLoading: boolean; error: boolean } {
  const [state, setState] = useState<{ data: T | null; isLoading: boolean; error: boolean }>({
    data: null,
    isLoading: false,
    error: false,
  })
  const key = body ? JSON.stringify(body) : null

  useEffect(() => {
    if (!modelId || !key) {
      setState({ data: null, isLoading: false, error: false })
      return
    }
    let cancelled = false
    setState({ data: null, isLoading: true, error: false })
    fetch(`/api/bim/models/${modelId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return (await response.json()) as Record<string, unknown>
      })
      .then((payload) => {
        if (!cancelled) setState({ data: pick(payload) ?? null, isLoading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, isLoading: false, error: true })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, key])

  return state
}

function CardShell({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string
  icon: typeof Boxes
  action?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="rounded-surface border bg-card p-5" aria-label={title}>
      {/* `flex-wrap`: the compliance card carries two actions, and beside the
          title they pushed the header 104px past a phone's edge. Wrapped, they
          take a line of their own under the title and stay beside it where
          there is room. */}
      <header className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function NoModel({
  isLoading = false,
  error = null,
  ambiguous = false,
  notReady = null,
}: {
  isLoading?: boolean
  error?: string | null
  ambiguous?: boolean
  notReady?: 'extracting' | 'failed' | null
} = {}): JSX.Element {
  const t = useTranslations(bimCopy)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-control border border-dashed p-6">
        <Spinner size="sm" />
      </div>
    )
  }
  return (
    <EmptyState
      title={
        error !== null
          ? t('preview.loadFailed')
          : ambiguous
            ? // "Not in this project" would be false: it is in the project
              t('card.ambiguousModel')
            : notReady === 'failed'
              ? // The one of these the reader can do something about.
                t('preview.extractionFailed')
              : notReady === 'extracting'
                ? t('preview.extracting')
                : t('card.noModel')
      }
    />
  )
}

const TOUCH_LINK = 'pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center'

const pickSchedule = (payload: Record<string, unknown>) =>
  payload.schedule
    ? {
        schedule: payload.schedule as BimRoomSchedule,
        truncated: payload.truncated === true,
      }
    : undefined

export interface IfcScheduleCardProps {
  title: string
  modelFile: string | null
  storey: string | null
  note: string | null
  projectId: string | null
}

export function IfcScheduleCard({
  title,
  modelFile,
  storey,
  note,
  projectId,
}: IfcScheduleCardProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const {
    model,
    isLoading: modelsLoading,
    error: modelsError,
    ambiguous,
    notReady,
  } = useResolvedModel(projectId, modelFile)
  const { data: payload, isLoading, error } = useModelQuery(
    model?.id ?? null,
    { op: 'schedule' },
    pickSchedule
  )
  const schedule = payload?.schedule ?? null

  const storeys = useMemo(() => {
    if (!schedule) return []
    if (!storey) return schedule.storeys
    const needle = storey.toLowerCase()
    return schedule.storeys.filter((entry) => entry.storeyName.toLowerCase() === needle)
  }, [schedule, storey])

  const number = (value: number | null) =>
    value === null ? '—' : value.toLocaleString(locale, { maximumFractionDigits: 2 })

  const download = () => {
    if (!schedule) return
    const csv = roomScheduleToCsv(
      { ...schedule, storeys },
      { storeyFilter: storey, truncated: payload?.truncated === true }
    )
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(model?.filename ?? 'modell').replace(/\.(ifc|ifczip)$/i, '')}-raumbuch.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    capturePosthog('report_exported', { kind: 'room_schedule', format: 'csv' })
  }

  return (
    <CardShell
      title={title}
      icon={Table2}
      action={
        schedule &&
        storeys.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={download}>
            <Download className="size-3.5" aria-hidden="true" />
            CSV
          </Button>
        )
      }
    >
      {!model ? (
        <NoModel isLoading={modelsLoading} error={modelsError} ambiguous={ambiguous} notReady={notReady} />
      ) : isLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <p className="text-sm text-destructive">{t('schedule.failed')}</p>
      ) : !schedule || schedule.totals.rooms === 0 ? (
        <EmptyState title={t('schedule.empty')} />
      ) : storeys.length === 0 ? (
        <EmptyState title={t('schedule.storeyEmpty', { storey: storey ?? '' })} />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    {t('schedule.room')}
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    {t('schedule.netArea')}
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    {t('schedule.volume')}
                  </th>
                </tr>
              </thead>
              {storeys.map((entry) => (
                <tbody key={entry.storeyName}>
                  <tr className="border-t">
                    <th scope="rowgroup" colSpan={3} className="pt-2 text-left text-xs font-medium">
                      {entry.storeyName}
                    </th>
                  </tr>
                  {entry.rooms.map((room) => (
                    <tr key={room.globalId} className="border-t/50">
                      <td className="py-1 pr-2">
                        {projectId ? (
                          <Link
                            href={buildModelHref(projectId, {
                              model: model.filename,
                              storey: entry.storeyName,
                              element: room.globalId,
                            })}
                            className={`underline-offset-2 hover:underline ${TOUCH_LINK}`}
                          >
                            {room.name}
                          </Link>
                        ) : (
                          room.name
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{number(room.netFloorArea)}</td>
                      <td className="py-1 text-right tabular-nums">{number(room.netVolume)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="py-1 pr-2">{t('schedule.storeyTotal')}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{number(entry.netFloorArea)}</td>
                    <td className="py-1 text-right tabular-nums">{number(entry.netVolume)}</td>
                  </tr>
                </tbody>
              ))}
              {/*
                Only when the table IS the building. With `storey` set the rows
                are one floor and `schedule.totals` is still the whole model,
                so a row labelled "Gesamt" under a single storey's rooms
                reported the building's Netto-Grundfläche as that floor's —
                the one number in this product that could do real damage, in
                the surface that ends up pasted into an email.
              */}
              {!storey && (
                <tfoot>
                  <tr className="border-t-2 font-medium">
                    <td className="py-1 pr-2">{t('schedule.total')}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {number(schedule.totals.netFloorArea)} {schedule.units.area}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {number(schedule.totals.netVolume)} {schedule.units.volume}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {payload?.truncated && (
            <p className="text-xs text-destructive">{t('schedule.truncated')}</p>
          )}
          {schedule.totals.roomsWithoutArea > 0 && (
            <p className="text-xs text-warning">
              {t('schedule.missing', { count: schedule.totals.roomsWithoutArea })}
            </p>
          )}
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
      )}
    </CardShell>
  )
}

const pickElement = (payload: Record<string, unknown>) =>
  payload.element as BimElementDetail | null | undefined

export interface IfcElementCardProps {
  title: string
  globalId: string
  modelFile: string | null
  note: string | null
  projectId: string | null
}

export function IfcElementCard({
  title,
  globalId,
  modelFile,
  note,
  projectId,
}: IfcElementCardProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const {
    model,
    isLoading: modelsLoading,
    error: modelsError,
    ambiguous,
    notReady,
  } = useResolvedModel(projectId, modelFile)
  const { data: element, isLoading, error } = useModelQuery(
    model?.id ?? null,
    { op: 'element', globalId },
    pickElement
  )

  return (
    <CardShell
      title={title}
      icon={Boxes}
      action={
        model && projectId ? (
          <Button asChild size="sm" variant="ghost">
            <Link
              href={buildModelHref(projectId, {
                model: model.filename,
                element: globalId,
                storey: element?.storeyName ?? undefined,
                highlights: [{ status: 'info', globalIds: [globalId] }],
              })}
            >
              {t('card.openModel')}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        ) : null
      }
    >
      {!model ? (
        <NoModel isLoading={modelsLoading} error={modelsError} ambiguous={ambiguous} notReady={notReady} />
      ) : isLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <p className="text-sm text-destructive">{t('properties.loadFailed')}</p>
      ) : !element ? (
        <EmptyState title={t('element.notFound')} />
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{shortIfcType(element.ifcType)}</span>
            {element.storeyName && (
              <span className="font-mono text-xs text-muted-foreground">{element.storeyName}</span>
            )}
            {element.typeName && <span className="text-muted-foreground">{element.typeName}</span>}
          </div>
          {element.materials.length > 0 && (
            <p className="text-muted-foreground">{element.materials.join(' · ')}</p>
          )}
          {Object.entries(element.properties).map(([setName, properties]) => (
            <div key={setName} className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground">{setName}</p>
              <dl className="space-y-0.5">
                {Object.entries(properties).map(([name, value]) => (
                  <div key={name} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{name}</dt>
                    <dd className="font-medium">{formatPropertyValue(value, locale)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {note && <p className="text-muted-foreground">{note}</p>}
        </div>
      )}
    </CardShell>
  )
}

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

const pickComparison = (payload: Record<string, unknown>) =>
  payload.comparison as BimComparison | undefined

const DIFF_ROWS = 6

interface DiffEntry {
  globalId: string
  ifcType: string
  name: string | null
  storeyName?: string | null
  changes?: Array<{ field: string; before: unknown; after: unknown }>
}

function DiffGroup({
  label,
  entries,
  status,
  projectId,
  filename,
  total,
}: {
  label: string
  entries: readonly DiffEntry[]
  status: 'info' | 'fail' | 'warning'
  projectId: string | null
  filename: string
  total: number
}): JSX.Element | null {
  const t = useTranslations(bimCopy)
  if (entries.length === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="space-y-1">
        {entries.slice(0, DIFF_ROWS).map((entry) => {
          const caption = `${shortIfcType(entry.ifcType)} · ${entry.name ?? entry.globalId}`
          return (
            <li key={entry.globalId}>
              <p>
                {projectId ? (
                  <Link
                    href={buildModelHref(projectId, {
                      model: filename,
                      element: entry.globalId,
                      highlights: [{ status, globalIds: [entry.globalId] }],
                    })}
                    className={`underline-offset-2 hover:underline ${TOUCH_LINK}`}
                  >
                    {caption}
                  </Link>
                ) : (
                  caption
                )}
                {entry.storeyName && (
                  <span className="text-xs text-muted-foreground"> · {entry.storeyName}</span>
                )}
              </p>
              {entry.changes && entry.changes.length > 0 && (
                <ul className="ml-3 text-xs text-muted-foreground">
                  {entry.changes.slice(0, 3).map((change) => (
                    <li key={change.field}>
                      {change.field}: {String(change.before ?? '—')} → {String(change.after ?? '—')}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {total > DIFF_ROWS && (
        <p className="text-xs text-muted-foreground">
          {total - DIFF_ROWS === 1
            ? t('compare.moreOne')
            : t('compare.more', { count: total - DIFF_ROWS })}
        </p>
      )}
    </div>
  )
}

export interface IfcDiffCardProps {
  title: string
  baseModelFile: string
  modelFile: string | null
  note: string | null
  projectId: string | null
}

export function IfcDiffCard({
  title,
  baseModelFile,
  modelFile,
  note,
  projectId,
}: IfcDiffCardProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const {
    model,
    models,
    isLoading: modelsLoading,
    error: modelsError,
    ambiguous,
    notReady,
  } = useResolvedModel(projectId, modelFile)
  const { model: baseModel, ambiguous: baseAmbiguous } = useMemo(
    () => resolveModelByFilename(models, baseModelFile),
    [models, baseModelFile]
  )

  const { data: comparison, isLoading, error } = useModelQuery(
    model && baseModel && model.id !== baseModel.id ? model.id : null,
    baseModel ? { op: 'compare', baseModelId: baseModel.id, limit: 20_000 } : null,
    pickComparison
  )

  return (
    <CardShell title={title} icon={GitCompare}>
      {!model || !baseModel ? (
        <NoModel
          isLoading={modelsLoading}
          error={modelsError}
          ambiguous={ambiguous || baseAmbiguous}
          notReady={notReady}
        />
      ) : model.id === baseModel.id ? (
        <EmptyState title={t('compare.sameRevision')} />
      ) : isLoading ? (
        <Spinner size="sm" />
      ) : error || !comparison ? (
        <p className="text-sm text-destructive">{t('compare.failed')}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {baseModel.filename} <ArrowRight className="inline size-3" aria-hidden="true" />{' '}
            {model.filename}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {/*
              `counts`, not the array lengths. `compare.ts` slices each list to
              `MAX_COMPARISON_ROWS = 500` and keeps the real figures on
              `counts` — the model page reads them, this card read the capped
              arrays. A revision that added 1 300 elements was reported to an
              architect as "Neu 500", on the surface that ends up in a
              screenshot.
            */}
            <Badge variant="success">
              {t('compare.added')} {comparison.counts.added}
            </Badge>
            <Badge variant="destructive">
              {t('compare.removed')} {comparison.counts.removed}
            </Badge>
            <Badge variant="warning">
              {t('compare.changed')} {comparison.counts.changed}
            </Badge>
            <Badge variant="secondary">
              {t('compare.unchanged')} {comparison.unchangedCount}
            </Badge>
          </div>
          {comparison.truncated && <p className="text-xs text-warning">{t('compare.truncated')}</p>}
          {/* Added and removed used to be counts and nothing else — the card
              said "Added 1" and gave no way to find out what. A delta you
              cannot open is a number, not an answer. Removed elements link
              into the BASE revision: they have no GlobalId in the new one, so
              a link into it would select nothing. */}
          <DiffGroup
            label={t('compare.added')}
            entries={comparison.added}
            total={comparison.counts.added}
            status="info"
            projectId={projectId}
            filename={model.filename}
          />
          <DiffGroup
            label={t('compare.removed')}
            entries={comparison.removed}
            total={comparison.counts.removed}
            status="fail"
            projectId={projectId}
            filename={baseModel.filename}
          />
          <DiffGroup
            label={t('compare.changed')}
            entries={comparison.changed}
            total={comparison.counts.changed}
            status="warning"
            projectId={projectId}
            filename={model.filename}
          />
          {note && <p className="text-muted-foreground">{note}</p>}
        </div>
      )}
    </CardShell>
  )
}
