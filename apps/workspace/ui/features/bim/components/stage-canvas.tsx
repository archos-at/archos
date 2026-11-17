import type { JSX } from 'react'

import { Boxes, MonitorX } from 'lucide-react'
import { Button } from '@/components/ui/button'

import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'

import { useModelViewport } from '../hooks/use-model-viewport'

import { IfcViewerCanvasLazy, ModelViewportProgress, ViewerRetry } from './ifc-model-viewer'

import { ViewerNotice } from './viewer'

export function StageCanvas({
  isLoading,
  error,
  onRetry,
  onClose,
  hasModels,
  model,
  source,
  viewport,
}: {
  isLoading: boolean
  error: string | null
  onRetry: () => void
  onClose: () => void
  hasModels: boolean
  model: { status: string; errorMessage: string | null } | null
  source: { data: string | null; error: string | null; reload: () => void }
  viewport: ReturnType<typeof useModelViewport>
}): JSX.Element {
  const t = useTranslations(bimCopy)

  if (isLoading && !hasModels) {
    return <ModelViewportProgress phase="downloading" percent={null} />
  }
  if (error) {
    return (
      <ViewerNotice
        icon={Boxes}
        title={t('loadFailed.title')}
        description={t('loadFailed.description')}
        action={<ViewerRetry onClick={onRetry} />}
      />
    )
  }
  if (!hasModels || !model) {
    return (
      <ViewerNotice
        icon={Boxes}
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            {t('empty.action')}
          </Button>
        }
      />
    )
  }
  if (model.status !== 'ready') {
    return (
      <ViewerNotice
        icon={Boxes}
        title={t(`status.${model.status}`)}
        description={
          model.errorMessage ??
          (model.status === 'failed' ? t('stage.readFailed') : t('stage.notReady'))
        }
      />
    )
  }
  if (!viewport.webGpu) {
    return (
      <ViewerNotice
        icon={MonitorX}
        title={t('viewer.unsupported.title')}
        description={t('viewer.unsupported.description')}
      />
    )
  }
  if (viewport.status.phase === 'error') {
    return (
      <ViewerNotice
        icon={MonitorX}
        title={t('viewer.unavailable.title')}
        description={t('viewer.unavailable.description')}
        detail={
          viewport.status.message
            ? t('viewer.unavailable.reason', { message: viewport.status.message })
            : undefined
        }
        action={<ViewerRetry onClick={source.reload} />}
      />
    )
  }
  if (source.error) {
    return (
      <ViewerNotice
        icon={MonitorX}
        title={t('viewer.unavailable.title')}
        description={t('viewer.unavailable.description')}
        action={<ViewerRetry onClick={source.reload} />}
      />
    )
  }
  if (!viewport.canvasProps) {
    return <ModelViewportProgress phase="downloading" percent={null} />
  }
  if (viewport.download.cancelled) {
    return (
      <ViewerNotice
        icon={Boxes}
        title={t('stage.download.cancelled.title')}
        description={t('stage.download.cancelled.description')}
        action={<ViewerRetry onClick={viewport.download.restart} label={t('stage.download.restart')} />}
      />
    )
  }

  return (
    <>
      <IfcViewerCanvasLazy {...viewport.canvasProps} className="size-full" />
      <ModelViewportProgress
        phase={viewport.status.phase}
        percent={viewport.status.percent}
        bytes={viewport.status.bytes}
        onCancel={viewport.download.cancel}
      />
    </>
  )
}
