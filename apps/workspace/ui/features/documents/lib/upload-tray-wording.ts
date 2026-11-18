import type { useTranslations } from '@/i18n'
import { formatByteProgress, formatBytes, formatDurationShort, formatTransferRate } from '@/lib/format'
import type { TransferSummary, UploadPhase } from './upload-progress'

export function phaseLabel(phase: UploadPhase, percent: number | null, t: ReturnType<typeof useTranslations>): string {
  switch (phase) {
    case 'uploading':
      return percent === null ? t('uploads.row.uploading') : `${percent}%`
    case 'queued':
      return t('uploads.row.queued')
    case 'processing':
      return t('uploads.row.processing')
    case 'ready':
      return t('uploads.row.ready')
    case 'held':
      return t('uploads.row.held')
    case 'stored':
      return t('uploads.row.stored')
    case 'canceled':
      return t('uploads.row.canceled')
    case 'failed':
      return t('uploads.row.failed')
  }
}

export function trayHeadline(summary: TransferSummary, t: ReturnType<typeof useTranslations>): string {
  if (summary.stage === 'transferring') {
    const count = summary.queued + summary.uploading
    return t(count === 1 ? 'uploads.heading.transferringOne' : 'uploads.heading.transferringOther', { count })
  }
  if (summary.stage === 'processing') {
    return t(summary.processing === 1 ? 'uploads.heading.processingOne' : 'uploads.heading.processingOther', {
      count: summary.processing,
    })
  }
  const added = summary.ready + summary.stored
  if (added > 0 && summary.failed > 0) {
    return t('uploads.heading.mixed', { ready: added, failed: summary.failed })
  }
  if (summary.failed > 0) {
    return t(summary.failed === 1 ? 'uploads.heading.failedOne' : 'uploads.heading.failedOther', {
      count: summary.failed,
    })
  }
  if (added > 0 && summary.held > 0) {
    return t('uploads.heading.mixedHeld', { ready: added, held: summary.held })
  }
  if (summary.held > 0) {
    return t(summary.held === 1 ? 'uploads.heading.heldOne' : 'uploads.heading.heldOther', { count: summary.held })
  }
  if (added > 0) {
    return t(added === 1 ? 'uploads.heading.doneOne' : 'uploads.heading.doneOther', { count: added })
  }
  return t('uploads.heading.canceled')
}

export function trayDetail(
  summary: TransferSummary,
  context: {
    bytesPerSecond: number | null
    etaSeconds: number | null
    processingElapsed: number
    locale: string
    t: ReturnType<typeof useTranslations>
  }
): string {
  const { bytesPerSecond, etaSeconds, processingElapsed, locale, t } = context

  if (summary.stage === 'transferring') {
    const parts = [t('uploads.detail.bytes', formatByteProgress(summary.uploadedBytes, summary.totalBytes, locale))]
    if (bytesPerSecond !== null) parts.push(formatTransferRate(bytesPerSecond, locale))
    if (etaSeconds !== null && etaSeconds > 0) {
      parts.push(t('uploads.detail.eta', { time: formatDurationShort(etaSeconds, locale) }))
    }
    if (summary.queued > 0) parts.push(t('uploads.detail.queued', { count: summary.queued }))
    return parts.join(' · ')
  }

  if (summary.stage === 'processing') {
    const parts = [t('uploads.detail.processing')]
    if (processingElapsed >= 5) {
      parts.push(t('uploads.detail.elapsed', { time: formatDurationShort(processingElapsed, locale) }))
    }
    return parts.join(' · ')
  }

  return t('uploads.detail.settled', { total: formatBytes(summary.uploadedBytes, locale) })
}
