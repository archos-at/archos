'use client'

import { type FC, useState, useEffect } from 'react'
import { Ban, Check, FileText, ShieldAlert, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { Transition } from 'motion/react'
import { motion, motionQuick, springDrawer, useMotionToken } from '@/components/motion'
import { useIsCurrentSessionBusy } from '@/features/chat'
import { useLocale, useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'
import { IngestFailureNotice } from '@/features/documents/components/ingest-failure-notice'
import { HeldUploadReason } from '@/features/documents/components/held-upload-reason'
import type { TrackedFile } from '@/features/documents/types'
import type { QuarantineVerdict } from '@/lib/upload-screening/quarantine'
import { formatBytes } from '@/lib/format'

export type FileSourceStatus =
  | 'uploading'
  | 'ingesting'
  | 'available'
  | 'held'
  | 'stored'
  | 'error'
  | 'deleting'
  | 'canceled'

export interface FileSourceCardProps {
  id: string
  title: string
  fileSize?: number | null
  uploadedAt?: Date | string | null
  description?: string
  status: FileSourceStatus
  errorMessage?: string
  quarantine?: QuarantineVerdict | null
  failedWhileReading?: boolean
  replacesHeld?: TrackedFile['replacesHeld']
  expirationIntervalHours?: number
  onDelete?: (id: string) => void
  onOpen?: (id: string) => void
}

const STATUS_CONFIG: Record<
  FileSourceStatus,
  { labelKey: string; textClass: string; showSpinner: boolean }
> = {
  uploading: {
    labelKey: 'fileSourceCard.statusUploading',
    textClass: 'text-info',
    showSpinner: true,
  },
  ingesting: {
    labelKey: 'fileSourceCard.statusIngesting',
    textClass: 'text-info',
    showSpinner: true,
  },
  available: {
    labelKey: 'fileSourceCard.statusAvailable',
    textClass: 'text-success',
    showSpinner: false,
  },
  held: {
    labelKey: 'fileSourceCard.statusHeld',
    textClass: 'text-warning',
    showSpinner: false,
  },
  stored: {
    labelKey: 'fileSourceCard.statusStored',
    textClass: 'text-muted-foreground',
    showSpinner: false,
  },
  error: {
    labelKey: 'fileSourceCard.statusError',
    textClass: 'text-error',
    showSpinner: false,
  },
  deleting: {
    labelKey: 'fileSourceCard.statusDeleting',
    textClass: 'text-muted-foreground',
    showSpinner: true,
  },
  canceled: {
    labelKey: 'fileSourceCard.statusCanceled',
    textClass: 'text-muted-foreground',
    showSpinner: false,
  },
}

const formatDateTime = (date: Date | string, locale?: string): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return dateObj.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const computeMsRemaining = (
  uploadedAt: Date | string | null | undefined,
  intervalHours: number
): number | null => {
  if (!uploadedAt || intervalHours <= 0) return null
  const dateObj = typeof uploadedAt === 'string' ? new Date(uploadedAt) : uploadedAt
  if (isNaN(dateObj.getTime())) return null
  const expiresAtMs = dateObj.getTime() + intervalHours * 60 * 60 * 1000
  return expiresAtMs - Date.now()
}

type ExpiryInfo = { expired: boolean; minutes: number }

const computeExpiryInfo = (msRemaining: number | null): ExpiryInfo | null => {
  if (msRemaining === null) return null
  if (msRemaining <= 0) return { expired: true, minutes: 0 }

  const totalMinutes = Math.max(1, Math.ceil(msRemaining / 60_000))
  return { expired: false, minutes: totalMinutes }
}

const useExpiryInfo = (
  uploadedAt: Date | string | null | undefined,
  intervalHours: number,
  active: boolean
): ExpiryInfo | null => {
  const [info, setInfo] = useState<ExpiryInfo | null>(() =>
    active ? computeExpiryInfo(computeMsRemaining(uploadedAt, intervalHours)) : null
  )

  useEffect(() => {
    if (!active) {
      setInfo(null)
      return
    }

    setInfo(computeExpiryInfo(computeMsRemaining(uploadedAt, intervalHours)))

    const id = setInterval(() => {
      setInfo(computeExpiryInfo(computeMsRemaining(uploadedAt, intervalHours)))
    }, 60_000)

    return () => clearInterval(id)
  }, [uploadedAt, intervalHours, active])

  return info
}

const cardTransition: Transition = { ...springDrawer, opacity: motionQuick }

export const FileSourceCard: FC<FileSourceCardProps> = ({
  id,
  title,
  fileSize,
  uploadedAt,
  description,
  status,
  errorMessage,
  quarantine = null,
  failedWhileReading = false,
  replacesHeld,
  expirationIntervalHours = 0,
  onDelete,
  onOpen,
}) => {
  const t = useTranslations(researchCopy)
  const { locale } = useLocale()
  const cardMotion = useMotionToken(cardTransition)
  const config = STATUS_CONFIG[status]
  const label = t(config.labelKey)
  const isBusy = useIsCurrentSessionBusy()
  const expiryInfo = useExpiryInfo(uploadedAt, expirationIntervalHours, status === 'available')

  const handleDelete = () => {
    onDelete?.(id)
  }

  const isProcessing = status === 'uploading' || status === 'ingesting'
  const isDeleting = status === 'deleting'
  const isCanceled = status === 'canceled'
  const deleteDisabled = !isCanceled && (isBusy || isProcessing || isDeleting)
  const canOpen = !!onOpen && status === 'available'

  const rowBody = (
    <>
      {/* File Icon or Spinner */}
      {config.showSpinner ? (
        <Spinner size="sm" label={label} />
      ) : (
        <FileText
          className={cn(
            'size-8',
            status === 'error' ? 'text-error' : status === 'held' ? 'text-warning' : 'text-muted-foreground'
          )}
          aria-hidden="true"
        />
      )}

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Title, file size, and timestamp */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          {fileSize != null && fileSize > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(fileSize, locale)}
            </span>
          )}
          {uploadedAt && (
            <>
              <span className="shrink-0 text-muted-foreground">•</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(uploadedAt, locale)}
              </span>
            </>
          )}
        </div>

        {/* Description (if provided) */}
        {description && (
          <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>
        )}

        {/* Status and expiration row */}
        <div className="mt-1 flex items-center gap-2">
          {/* Status indicator */}
          <span className="flex items-center gap-1">
            {status === 'available' && (
              <Check className="size-3 text-success" aria-hidden="true" />
            )}
            {status === 'error' && <X className="size-3 text-error" aria-hidden="true" />}
            {status === 'held' && <ShieldAlert className="size-3 text-warning" aria-hidden="true" />}
            {isCanceled && <Ban className="size-3 text-muted-foreground" aria-hidden="true" />}
            <span className={cn(config.showSpinner ? 'text-sm' : 'text-xs', config.textClass)}>
              {label}
            </span>
          </span>

          {/* Expiration countdown */}
          {expiryInfo && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className={cn('text-xs', expiryInfo.expired ? 'text-error' : 'text-warning')}>
                {expiryInfo.expired
                  ? t('fileSourceCard.expiryPending')
                  : t('fileSourceCard.expiresIn', { minutes: expiryInfo.minutes })}
              </span>
            </>
          )}
        </div>

        {/* Error message */}
        {status === 'error' && errorMessage && failedWhileReading ? (
          <IngestFailureNotice
            errorMessage={errorMessage}
            className="mt-1"
            sentenceClassName="text-error"
            testId="file-source-card-failure"
          />
        ) : (
          status === 'error' &&
          errorMessage && <span className="mt-1 text-xs text-error">{errorMessage}</span>
        )}

        {/* Why it was held, and the sentence that says what happens next: the
            same reasons the tray and the Files preview list, from the typed
            verdict, never a stored message behind a „Details“ disclosure. */}
        {status === 'held' && (
          <HeldUploadReason
            verdict={quarantine}
            replacesHeld={replacesHeld}
            message={errorMessage}
            className="mt-1"
            testId="file-source-card-held"
          />
        )}
      </div>
    </>
  )

  return (
    <motion.div
      className={cn(
        'group flex items-start justify-between rounded-surface bg-card p-3 transition-colors duration-quick ease-out shadow-xs',
        status === 'error' && 'ring-1 ring-error/40'
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isDeleting ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={cardMotion}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {canOpen ? (
          <button
            type="button"
            onClick={() => onOpen?.(id)}
            aria-label={t('fileSourceCard.open', { title })}
            className="focus-visible:ring-ring/50 -m-1 flex min-w-0 flex-1 items-center gap-3 rounded-control p-1 text-left focus-visible:outline-none focus-visible:ring-2"
          >
            {rowBody}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{rowBody}</div>
        )}

        {/* Delete button */}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-2 size-8 flex-shrink-0 rounded-control text-muted-foreground opacity-0 transition-opacity duration-quick ease-out hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
            onClick={handleDelete}
            disabled={deleteDisabled}
            aria-label={
              isCanceled
                ? t('fileSourceCard.dismiss', { title })
                : deleteDisabled
                  ? t('fileSourceCard.deleteDisabled', { title })
                  : t('fileSourceCard.delete', { title })
            }
            title={
              isCanceled
                ? t('fileSourceCard.dismiss', { title })
                : isProcessing
                  ? t('fileSourceCard.waitUpload')
                  : deleteDisabled
                    ? t('fileSourceCard.cannotDeleteBusy')
                    : t('fileSourceCard.deleteFile')
            }
          >
            {isCanceled ? <X className="size-4" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
          </Button>
        )}
      </div>
    </motion.div>
  )
}

export const FileSourceCardSkeleton: FC = () => (
  <div className="flex items-center gap-3 rounded-surface bg-card p-3 shadow-xs">
    <Skeleton className="size-8 shrink-0 rounded-control" />
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Skeleton className="h-3.5 w-1/2" />
      <Skeleton className="h-3 w-1/4" />
    </div>
  </div>
)
