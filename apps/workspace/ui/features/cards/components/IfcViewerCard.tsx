'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { Boxes, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { IfcModelViewer } from '@/features/bim/components/ifc-model-viewer'
import { resolveHighlights, storeyKey, supportsWebGpu } from '@/features/bim/lib/model-index'
import { buildModelHref } from '@/features/bim/lib/model-link'
import {
  notReadyModelStatus,
  resolveModelByFilename,
  useBimElements,
  useBimHighlightGroups,
  useBimModelSource,
  useProjectBimModels,
  type BimHighlightSpec,
} from '@/features/bim/hooks/use-bim-model'

export interface IfcViewerCardProps {
  title: string
  modelFile: string | null
  storey: string | null
  note: string | null
  highlights: BimHighlightSpec[]
  projectId: string | null
}

export function IfcViewerCard({
  title,
  modelFile,
  storey,
  note,
  highlights,
  projectId,
}: IfcViewerCardProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const { data: models, isLoading: modelsLoading, error: modelsError } = useProjectBimModels(projectId)

  const { model, ambiguous } = useMemo(
    () => resolveModelByFilename((models ?? []).filter((c) => c.status === 'ready'), modelFile),
    [models, modelFile]
  )
  const notReady = useMemo(
    () => (model ? null : notReadyModelStatus(models ?? [], modelFile)),
    [model, models, modelFile]
  )

  const {
    data: elements,
    isLoading: elementsLoading,
    error: elementsError,
    reload: reloadElements,
  } = useBimElements(model?.id ?? null)
  const elementsReady = elements !== null && !elementsLoading && elementsError === null
  const storeyMissing = useMemo(() => {
    if (!storey || !elements || elements.length === 0) return false
    const wanted = storeyKey(storey)
    return !elements.some((element) => storeyKey(element.storeyName) === wanted)
  }, [storey, elements])

  const webGpu = useMemo(() => supportsWebGpu(), [])
  const source = useBimModelSource(model?.id ?? null, webGpu)

  const { data: groups, error: groupsError } = useBimHighlightGroups(model?.id ?? null, highlights)
  const resolved = useMemo(() => groups ?? [], [groups])

  const unresolvedCount = useMemo(
    () =>
      !elementsReady || elements === null
        ? 0
        : resolveHighlights(resolved, elements).reduce((total, group) => total + group.unresolved.length, 0),
    [resolved, elements, elementsReady]
  )

  const openHref = useMemo(
    () =>
      buildModelHref(projectId ?? '', {
        ...(model ? { model: model.filename } : {}),
        ...(storey ? { storey } : {}),
        ...(resolved.length > 0 ? { highlights: resolved } : {}),
        ...(resolved.length > 0 ? { xray: true } : {}),
      }),
    [projectId, model, storey, resolved]
  )

  return (
    <section className="rounded-surface border bg-card p-4" aria-label={title}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-medium">{title}</h3>
        </div>
        {model && projectId && (
          <Button asChild size="sm" variant="ghost">
            <Link href={openHref}>
              {t('card.openModel')}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </header>

      {modelsLoading && models === null ? (
        <div className="flex items-center justify-center rounded-control border border-dashed p-6">
          <Spinner size="sm" />
        </div>
      ) : modelsError !== null ? (
        <p className="rounded-surface border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('preview.loadFailed')}
        </p>
      ) : !model ? (
        <p className="rounded-surface border border-dashed p-6 text-center text-sm text-muted-foreground">
          {/*
            "Not available in this project" would be false for an ambiguous
            name: the model is in the project twice over, which is exactly why
            nothing is drawn. Told the wrong sentence, an architect goes looking
            for a building that is already uploaded.
          */}
          {ambiguous
            ? t('card.ambiguousModel')
            : notReady === 'failed'
              ? t('preview.extractionFailed')
              : notReady === 'extracting'
                ? t('preview.extracting')
                : t('card.noModel')}
        </p>
      ) : storeyMissing ? (
        <p className="rounded-surface border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('schedule.storeyEmpty', { storey: storey ?? '' })}
        </p>
      ) : source.error !== null ? (
        <p className="rounded-surface border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('preview.sourceFailed')}
        </p>
      ) : (
        <IfcModelViewer
          sourceUrl={source.data}
          onRetry={source.reload}
          elements={elements ?? []}
          highlights={elementsReady ? resolved : []}
          isolatedStorey={storey}
          className="h-72"
        />
      )}

      {/*
        The walk that resolves every highlight failed, so nothing is coloured.
        Without this the card showed an uncoloured building under a title that
        promises a marked one, and said nothing at all.
      */}
      {elementsError !== null && (
        <p className="text-warning mt-2 flex flex-wrap items-center gap-2 text-xs">
          {t('stage.elementsFailed')}
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={reloadElements}>
            {t('loadFailed.action')}
          </Button>
        </p>
      )}
      {groupsError !== null && (
        <p className="text-warning mt-2 text-xs">{t('card.highlightsFailed')}</p>
      )}
      {unresolvedCount > 0 && (
        <p className="mt-2 text-xs text-warning">
          {unresolvedCount === 1
            ? t('card.unresolvedOne')
            : t('card.unresolved', { count: unresolvedCount })}
        </p>
      )}
      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
    </section>
  )
}
