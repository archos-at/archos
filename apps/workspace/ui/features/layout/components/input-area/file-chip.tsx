import { type FC, type ReactNode, useEffect, useState } from 'react'
import { Check, FileText, RotateCw, ShieldAlert, X, XCircle } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { motion, useIconSwapTransition } from '@/components/motion'
import type { TrackedFile } from '@/features/documents/types'
import { failedWhileReading } from '@/features/documents/lib/ingest-failure'
import { useIngestFailureText } from '@/features/documents/components/ingest-failure-notice'
import { heldSentenceKey, quarantineVerdictOf } from '@/lib/upload-screening/quarantine'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { researchCopy } from '@/i18n/namespaces/research'
import { isInlinePreviewable } from '@/lib/documents/preview-types'

function usePhotoThumbnail(file: File | undefined): ReactNode {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file || !file.type.startsWith('image/') || !isInlinePreviewable(file.type) || typeof URL.createObjectURL !== 'function') {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  if (!url) return null
  return (
    // oxlint-disable-next-line nextjs/no-img-element -- a blob: URL of a file in this tab; the optimizer cannot fetch it
    <img
      src={url}
      alt=""
      aria-hidden="true"
      data-testid="file-chip-thumbnail"
      className="size-5 shrink-0 rounded-[4px] object-cover pointer-coarse:size-8"
    />
  )
}

export const FileChip: FC<{
  file: TrackedFile
  onOpen: (file: TrackedFile) => void
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  readOnly?: boolean
}> = ({ file, onOpen, onRemove, onRetry, readOnly = false }) => {
  const t = useTranslations(researchCopy)
  const isPending = file.status === 'uploading' || file.status === 'ingesting'
  const isFailed = file.status === 'failed'
  const isHeld = file.status === 'held'
  const isStored = file.status === 'stored'
  const isSuccess = file.status === 'success'
  const [sawPending, setSawPending] = useState(isPending)
  if (isPending && !sawPending) setSawPending(true)
  const glyph = useIconSwapTransition()
  const thumbnail = usePhotoThumbnail(file.file)
  const tFiles = useTranslations(filesCopy)
  const heldSentence = isHeld
    ? file.replacesHeld
      ? file.errorMessage
      : tFiles(heldSentenceKey(quarantineVerdictOf(file)))
    : null
  const ingestFailure = useIngestFailureText(
    isFailed && failedWhileReading(file) ? file.errorMessage : null
  )
  const statusTitle = isPending
    ? t(
        file.status === 'ingesting'
          ? 'fileSourceCard.statusIngesting'
          : 'inputArea.fileUploadingStatus'
      )
    : isHeld
      ? heldSentence || t('fileSourceCard.statusHeld')
      : isStored
        ? t('fileSourceCard.statusStored')
        : isFailed
          ? (ingestFailure?.sentence ?? (file.errorMessage || t('inputArea.fileFailedStatus')))
          : t('inputArea.fileReadyStatus')

  const statusIcon = isPending ? (
    <Spinner size="xs" className="text-muted-foreground" />
  ) : isHeld ? (
    <>
      <ShieldAlert className="text-warning size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('fileSourceCard.statusHeld')}</span>
    </>
  ) : isStored ? (
    <>
      <FileText className="text-muted-foreground size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('fileSourceCard.statusStored')}</span>
    </>
  ) : isFailed ? (
    <>
      <XCircle className="text-destructive size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('inputArea.fileFailedStatus')}</span>
    </>
  ) : (
    <motion.span
      className="inline-flex shrink-0"
      initial={sawPending ? { opacity: 0, scale: 0.6 } : false}
      animate={{ opacity: 1, scale: 1, transition: glyph.enter }}
    >
      <Check className="text-status-active size-3 shrink-0" aria-hidden="true" />
    </motion.span>
  )

  return (
    <span
      className={cn(
        'bg-card inline-flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs',
        'pointer-coarse:h-11 pointer-coarse:max-w-[260px]',
        isFailed && 'border-error'
      )}
      title={`${file.fileName} — ${statusTitle}`}
    >
      {isSuccess ? (
        <button data-attr="chat-open"
          type="button"
          onClick={() => onOpen(file)}
          aria-label={t('inputArea.openFile', { name: file.fileName })}
          className="text-foreground/85 focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-1.5 rounded-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
        >
          {statusIcon}
          {thumbnail}
          <span className="min-w-0 truncate">{file.fileName}</span>
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {statusIcon}
          {thumbnail}
          <span className="text-foreground/85 min-w-0 truncate">{file.fileName}</span>
        </span>
      )}
      {isFailed && !readOnly && (
        <button data-attr="chat-retry"
          type="button"
          onClick={() => onRetry(file.id)}
          aria-label={t('inputArea.retryUpload')}
          title={t('inputArea.retryUpload')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex shrink-0 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11"
        >
          <RotateCw className="size-3" aria-hidden="true" />
        </button>
      )}
      {!readOnly && (
        <button data-attr="chat-remove"
          type="button"
          onClick={() => onRemove(file.id)}
          aria-label={t('inputArea.removeFile', { name: file.fileName })}
          title={t('inputArea.removeFile', { name: file.fileName })}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex shrink-0 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}
