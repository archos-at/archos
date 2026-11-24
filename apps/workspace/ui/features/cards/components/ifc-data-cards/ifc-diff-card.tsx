'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight, GitCompare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { BimComparison } from '@/lib/bim/compare'
import { buildModelHref } from '@/features/bim/lib/model-link'
import { shortIfcType } from '@/features/bim/lib/model-index'
import { resolveModelByFilename } from '@/features/bim/hooks/use-bim-model'
import { useModelQuery } from '../../hooks/use-model-query'
import { useResolvedModel } from '../../hooks/use-resolved-model'
import { CardShell } from './card-shell'
import { NoModel } from './no-model'
import { TOUCH_LINK } from './touch-link'

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
