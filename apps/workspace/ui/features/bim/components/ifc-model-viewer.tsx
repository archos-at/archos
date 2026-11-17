'use client'

import type { JSX } from 'react'
import dynamic from 'next/dynamic'
import { MonitorX, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { cn } from '@/lib/utils'
import { useModelViewport, type UseModelViewportOptions } from '../hooks/use-model-viewport'
import { formatDownloadProgress } from '../lib/format-value'
import { ViewerLegend, ViewerNotice, ViewerProgress } from './viewer'

export const IfcViewerCanvasLazy = dynamic(
  () => import('./ifc-viewer-canvas').then((module) => module.IfcViewerCanvas),
  { ssr: false }
)

export interface IfcModelViewerProps extends UseModelViewportOptions {
  className?: string
  onRetry?: () => void
}

export function IfcModelViewer({ className, onRetry, ...options }: IfcModelViewerProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const viewport = useModelViewport({ ...options, compact: options.compact ?? true })

  if (!viewport.webGpu) {
    return (
      <div className={cn('rounded-xl border border-dashed', className)}>
        <ViewerNotice
          icon={MonitorX}
          title={t('viewer.unsupported.title')}
          description={t('viewer.unsupported.description')}
        />
      </div>
    )
  }

  if (!viewport.canvasProps) {
    return (
      <div className={cn('relative overflow-hidden rounded-xl border border-dashed', className)}>
        <ModelViewportProgress phase="downloading" percent={null} />
      </div>
    )
  }

  if (viewport.status.phase === 'error') {
    return (
      <div className={cn('rounded-xl border border-dashed', className)}>
        <ViewerNotice
          icon={MonitorX}
          title={t('viewer.unavailable.title')}
          description={t('viewer.unavailable.description')}
          detail={
            viewport.status.message
              ? t('viewer.unavailable.reason', { message: viewport.status.message })
              : undefined
          }
          action={<ViewerRetry onClick={onRetry ?? viewport.download.restart} />}
        />
      </div>
    )
  }

  if (viewport.download.cancelled) {
    return (
      <div className={cn('relative overflow-hidden rounded-xl border border-dashed', className)}>
        <ViewerNotice
          icon={MonitorX}
          title={t('stage.download.cancelled.title')}
          description={t('stage.download.cancelled.description')}
          action={<ViewerRetry onClick={viewport.download.restart} label={t('stage.download.restart')} />}
        />
      </div>
    )
  }

  return (
    <div className={cn('bg-muted relative overflow-hidden rounded-xl border', className)}>
      <IfcViewerCanvasLazy {...viewport.canvasProps} className="size-full" />
      <ModelViewportProgress
        phase={viewport.status.phase}
        percent={viewport.status.percent}
        bytes={viewport.status.bytes}
        onCancel={viewport.download.cancel}
      />
      <ViewerLegend
        className="absolute bottom-2 left-2"
        entries={viewport.highlights.map((highlight) => ({
          status: highlight.status,
          label: highlight.label,
          count: highlight.expressIds.length,
        }))}
      />
    </div>
  )
}

export function ViewerRetry({ onClick, label }: { onClick: () => void; label?: string }): JSX.Element {
  const t = useTranslations(bimCopy)
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      <RotateCcw className="size-3.5" aria-hidden="true" />
      {label ?? t('loadFailed.action')}
    </Button>
  )
}

export function ModelViewportProgress({
  phase,
  percent,
  bytes,
  onCancel,
}: {
  phase: 'idle' | 'downloading' | 'parsing' | 'ready' | 'error'
  percent: number | null
  bytes?: { loaded: number; total: number }
  onCancel?: () => void
}): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  if (phase === 'ready' || phase === 'error') return null
  const downloading = phase === 'downloading'
  return (
    <ViewerProgress
      label={t(phase === 'parsing' ? 'stage.building' : 'stage.loading')}
      percent={downloading ? percent : null}
      detail={
        downloading && bytes && bytes.loaded > 0
          ? formatDownloadProgress(bytes.loaded, bytes.total, locale, (loaded, total) =>
              t('stage.download.of', { loaded, total })
            )
          : undefined
      }
      cancel={
        downloading && onCancel ? { label: t('stage.download.cancel'), onClick: onCancel } : undefined
      }
    />
  )
}
