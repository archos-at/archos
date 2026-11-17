'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, GitCompare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { compareBimModel } from '@/adapters/api/bim-client'
import type { BimComparison } from '@/lib/bim/compare'
import type { BimModelHeaderView } from '../hooks/use-bim-model'
import { shortIfcType } from '../lib/model-index'

export interface IfcModelCompareProps {
  modelId: string
  candidates: readonly BimModelHeaderView[]
  requested?: { baseModelId: string; at: number } | null
}

const VISIBLE_ROWS = 8

function DiffElided({ shown, total }: { shown: number; total: number }): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const listed = Math.min(shown, VISIBLE_ROWS)
  if (total <= listed) return null
  const elided = total - listed
  return (
    <li className="text-muted-foreground text-xs">
      {elided === 1 ? t('compare.moreOne') : t('compare.more', { count: elided })}
    </li>
  )
}

export function IfcModelCompare({
  modelId,
  candidates,
  requested = null,
}: IfcModelCompareProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const [baseModelId, setBaseModelId] = useState<string>(candidates[0]?.id ?? '')
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [comparison, setComparison] = useState<
    { result: BimComparison; baseModelId: string } | null
  >(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )

  useEffect(() => {
    generation.current += 1
    setComparison(null)
    setState('idle')
    setBaseModelId(candidates[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  const run = async (base: string = baseModelId) => {
    if (!base) return
    generation.current += 1
    const ticket = generation.current
    setState('loading')
    setComparison(null)
    try {
      const result = await compareBimModel(modelId, { baseModelId: base, limit: 20_000 })
      if (generation.current !== ticket) return
      setComparison(result ? { result, baseModelId: base } : null)
      setState('idle')
    } catch {
      if (generation.current !== ticket) return
      setState('error')
    }
  }

  const ranAgainst = comparison
    ? (candidates.find((candidate) => candidate.id === comparison.baseModelId)?.filename ?? null)
    : null

  useEffect(() => {
    if (!requested?.baseModelId) return
    setBaseModelId(requested.baseModelId)
    void run(requested.baseModelId)
    heading.current?.scrollIntoView({ block: 'nearest' })
    heading.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested?.baseModelId, requested?.at])

  return (
    <section aria-labelledby="bim-compare-heading" className="space-y-2">
      <h2
        ref={heading}
        tabIndex={-1}
        id="bim-compare-heading"
        className="flex items-center gap-2 text-sm font-medium focus-visible:outline-none"
      >
        <GitCompare className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('compare.title')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('compare.description')}</p>

      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('compare.none')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Field orientation="horizontal" className="items-center gap-2">
            <FieldLabel htmlFor="bim-compare-base" className="text-muted-foreground">
              {t('compare.against')}
            </FieldLabel>
            <Select value={baseModelId} onValueChange={setBaseModelId}>
              <SelectTrigger id="bim-compare-base" size="sm" className="max-w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void run()}
            disabled={state === 'loading'}
          >
            {state === 'loading' ? <Spinner className="size-3" /> : null}
            {state === 'loading' ? t('compare.running') : t('compare.run')}
          </Button>
        </div>
      )}

      {state === 'error' && <p className="text-sm text-destructive">{t('compare.failed')}</p>}

      {comparison && (
        <div className="space-y-3">
          {/* Which two files these numbers are the difference between. The
              select above is a control, not a caption: it moves freely after a
              run, and four counts with no stated subject take their meaning
              from whatever it happens to be pointing at. */}
          {ranAgainst && (
            <p className="text-xs text-muted-foreground">
              {t('compare.ranAgainst', { model: ranAgainst })}
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="success">
              {t('compare.added')} {comparison.result.counts.added}
            </Badge>
            <Badge variant="destructive">
              {t('compare.removed')} {comparison.result.counts.removed}
            </Badge>
            <Badge variant="warning">
              {t('compare.changed')} {comparison.result.counts.changed}
            </Badge>
            <Badge variant="secondary">
              {t('compare.unchanged')} {comparison.result.unchangedCount}
            </Badge>
          </div>

          {comparison.result.truncated && (
            <p className="rounded-md bg-warning-subtle p-2 text-xs text-warning">
              {t('compare.truncated')}
            </p>
          )}

          {comparison.result.added.length === 0 &&
          comparison.result.removed.length === 0 &&
          comparison.result.changed.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('compare.empty')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {/*
                The `+ − ~` glyphs are `aria-hidden`, and they were the ONLY
                thing separating an added element from a deleted one: the three
                buckets are concatenated into one list, so "Wall · Wand-3" read
                identically whether that wall appeared or vanished — on the
                panel an office resubmits from. An `sr-only` word beside each
                glyph carries what the colour and the symbol carry visually,
                and changes nothing on screen.
              */}
              {comparison.result.added.slice(0, VISIBLE_ROWS).map((entry) => (
                <li key={`added-${entry.globalId}`} className="flex gap-2">
                  <span aria-hidden="true" className="text-success">
                    +
                  </span>
                  <span className="sr-only">{t('compare.added')}</span>
                  <span className="truncate">
                    {shortIfcType(entry.ifcType)} · {entry.name ?? entry.globalId}
                  </span>
                </li>
              ))}
              {/*
                Each bucket says what it left out, directly under itself. Eight
                rows per bucket is a deliberate cap on a panel in a 26 rem
                drawer, and it was silent: the badges above give the totals,
                but nothing on the list said the list was a sample — on the
                panel an office resubmits from.
              */}
              <DiffElided shown={comparison.result.added.length} total={comparison.result.counts.added} />
              {comparison.result.removed.slice(0, VISIBLE_ROWS).map((entry) => (
                <li key={`removed-${entry.globalId}`} className="flex gap-2">
                  <span aria-hidden="true" className="text-destructive">
                    −
                  </span>
                  <span className="sr-only">{t('compare.removed')}</span>
                  <span className="truncate">
                    {shortIfcType(entry.ifcType)} · {entry.name ?? entry.globalId}
                  </span>
                </li>
              ))}
              <DiffElided
                shown={comparison.result.removed.length}
                total={comparison.result.counts.removed}
              />
              {comparison.result.changed.slice(0, VISIBLE_ROWS).map((entry) => (
                <li key={`changed-${entry.globalId}`} className="space-y-0.5">
                  <p className="flex gap-2">
                    <span aria-hidden="true" className="text-warning">
                      ~
                    </span>
                    <span className="sr-only">{t('compare.changed')}</span>
                    <span className="truncate">
                      {shortIfcType(entry.ifcType)} · {entry.name ?? entry.globalId}
                    </span>
                  </p>
                  <ul className="ml-5 space-y-0.5 text-xs text-muted-foreground">
                    {entry.changes.slice(0, 4).map((change) => (
                      <li key={change.field} className="flex flex-wrap items-center gap-1">
                        <span className="font-medium">{change.field}</span>
                        <span>{String(change.before ?? '—')}</span>
                        <ArrowRight className="size-3" aria-hidden="true" />
                        <span>{String(change.after ?? '—')}</span>
                        {change.delta !== null && (
                          <span className="tabular-nums">
                            ({change.delta > 0 ? '+' : ''}
                            {change.delta})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              <DiffElided
                shown={comparison.result.changed.length}
                total={comparison.result.counts.changed}
              />
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
