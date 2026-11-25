'use client'

import type { JSX, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Boxes, ExternalLink, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { cn } from '@/lib/utils'
import { bimCopy } from '@/i18n/namespaces/bim'
import { IfcModelViewer } from '@/features/bim/components/ifc-model-viewer'
import { resolveHighlights, storeyKey, supportsWebGpu } from '@/features/bim/lib/model-index'
import { buildModelHref } from '@/features/bim/lib/model-link'
import { CARD_SHELL } from './card-chrome'
import {
  loadsOnSight,
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
  const [opened, setOpened] = useState(false)
  const waitsForPress = model !== null && !opened && !loadsOnSight(model)
  const source = useBimModelSource(model?.id ?? null, webGpu && !waitsForPress)

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
    <Card className={cn(CARD_SHELL, 'gap-3 p-4 sm:p-5')} aria-label={title} role="region">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Boxes className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <h3 className="card-title text-foreground min-w-0">{title}</h3>
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
        <div className="flex h-72 items-center justify-center">
          <Spinner size="sm" />
        </div>
      ) : modelsError !== null ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t('preview.loadFailed')}
        </p>
      ) : !model ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
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
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t('schedule.storeyEmpty', { storey: storey ?? '' })}
        </p>
      ) : source.error !== null ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t('preview.sourceFailed')}
        </p>
      ) : waitsForPress ? (
        <ModelLoadPrompt
          bytes={model.summary?.fileSizeBytes ?? null}
          elementCount={model.elementCount}
          onLoad={() => setOpened(true)}
        />
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
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <TriangleAlert className="text-warning size-3.5 shrink-0" aria-hidden="true" />
          {t('stage.elementsFailed')}
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={reloadElements}>
            {t('loadFailed.action')}
          </Button>
        </p>
      )}
      {groupsError !== null && (
        <CardWarning>{t('card.highlightsFailed')}</CardWarning>
      )}
      {unresolvedCount > 0 && (
        <CardWarning>
          {unresolvedCount === 1
            ? t('card.unresolvedOne')
            : t('card.unresolved', { count: unresolvedCount })}
        </CardWarning>
      )}
      {note && <p className="text-muted-foreground text-sm">{note}</p>}
    </Card>
  )
}

function CardWarning({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-xs">
      <TriangleAlert className="text-warning mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function ModelLoadPrompt({
  bytes,
  elementCount,
  onLoad,
}: {
  bytes: number | null
  elementCount: number
  onLoad: () => void
}): JSX.Element {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const size =
    bytes === null
      ? '–'
      : `${(bytes / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 0 })} MB`
  return (
    <div
      className="bg-desk rounded-control flex h-72 flex-col items-center justify-center gap-3 px-6 text-center"
      data-testid="ifc-card-load-prompt"
    >
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">{t('card.load.title')}</p>
        <p className="text-muted-foreground text-xs">
          {t('card.load.description', { size, count: elementCount.toLocaleString(locale) })}
        </p>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onLoad}>
        <Boxes className="size-3.5" aria-hidden="true" />
        {t('card.load.action')}
      </Button>
    </div>
  )
}
