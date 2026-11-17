'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Boxes } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { cn } from '@/lib/utils'
import {
  useBimElements,
  useBimModelSource,
  useDocumentBimModel,
  useProjectBimModels,
} from '../hooks/use-bim-model'
import { supportsWebGpu } from '../lib/model-index'
import { buildOfficeShelfModelHref, buildModelHref } from '../lib/model-link'
import { IfcModelViewer } from './ifc-model-viewer'

interface IfcFilePreviewProps {
  documentId: string
  filename: string
  projectId?: string | null
  canOpenWorkspace?: boolean
  className?: string
}

export function IfcFilePreview({
  documentId,
  filename,
  projectId,
  canOpenWorkspace = true,
  className,
}: IfcFilePreviewProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const webGpu = useMemo(() => supportsWebGpu(), [])
  const models = useProjectBimModels(projectId ?? null)
  const documentModel = useDocumentBimModel(projectId ? null : documentId)

  const model = useMemo(
    () =>
      projectId
        ? (models.data?.find((candidate) => candidate.documentId === documentId) ?? null)
        : documentModel.data,
    [projectId, models.data, documentModel.data, documentId]
  )
  const ready = model?.status === 'ready' ? model : null

  const source = useBimModelSource(ready?.id ?? null, webGpu && ready !== null)
  const elements = useBimElements(ready?.id ?? null)

  const lookup = projectId
    ? { isLoading: models.isLoading, hasData: models.data !== null, error: models.error }
    : { isLoading: documentModel.isLoading, hasData: documentModel.data !== null, error: documentModel.error }

  const href = !canOpenWorkspace
    ? undefined
    : projectId
      ? buildModelHref(projectId, { model: filename })
      : buildOfficeShelfModelHref({ model: filename })

  if (lookup.isLoading && !lookup.hasData) {
    return <PreviewNote className={className} text={t('preview.loading')} />
  }

  if (lookup.error !== null) {
    return (
      <PreviewNote
        className={className}
        text={t('preview.loadFailed')}
        href={href}
        label={t('preview.open')}
      />
    )
  }

  if (!ready) {
    const text =
      model?.status === 'failed'
        ? t('preview.extractionFailed')
        : model
          ? t('preview.extracting')
          : t('preview.noModel')
    return (
      <PreviewNote
        className={className}
        text={text}
        href={model ? href : undefined}
        label={t('preview.open')}
      />
    )
  }

  if (!webGpu) {
    return (
      <PreviewNote
        className={className}
        text={t('preview.noWebGpu')}
        href={href}
        label={t('preview.open')}
      />
    )
  }

  if (source.error !== null) {
    return (
      <PreviewNote
        className={className}
        text={t('preview.sourceFailed')}
        href={href}
        label={t('preview.open')}
      />
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <IfcModelViewer
        sourceUrl={source.data}
        onRetry={source.reload}
        elements={elements.data ?? NO_ELEMENTS}
        className="min-h-[220px] flex-1"
      />
      {/* Offered on every surface now, project or Archiv — see the header. */}
      {href && <OpenInWorkspace href={href} label={t('preview.open')} />}
    </div>
  )
}

const NO_ELEMENTS: never[] = []

function PreviewNote({
  text,
  className,
  href,
  label,
}: {
  text: string
  className?: string
  href?: string
  label?: string
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center',
        'animate-in fade-in-0 duration-base ease-out motion-reduce:animate-none',
        className
      )}
    >
      <Boxes className="size-6 text-muted-foreground" aria-hidden />
      <p className="max-w-prose text-sm text-muted-foreground text-balance">{text}</p>
      {href && label && <OpenInWorkspace href={href} label={label} />}
    </div>
  )
}

function OpenInWorkspace({ href, label }: { href: string; label: string }): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center justify-center gap-1.5 self-center rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-quick ease-out hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-target"
    >
      {label}
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
    </Link>
  )
}

export default IfcFilePreview
