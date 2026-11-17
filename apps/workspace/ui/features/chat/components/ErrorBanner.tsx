'use client'

import { type FC, useId, useState } from 'react'
import { ChevronDown, ChevronUp, AlertTriangle, XCircle, X, RotateCw, Check, Copy } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AnimatePresence } from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { commonCopy } from '@/i18n/namespaces/common'
import { formatTime } from '@/shared/utils/format-time'
import { shortRequestId } from '@/shared/utils/request-id'
import type { ErrorCode } from '../types'
import { getErrorMeta } from '../lib/error-registry'

export type { ErrorCode }

export interface ErrorBannerProps {
  code: ErrorCode
  message?: string
  details?: string
  timestamp?: Date | string
  onDismiss?: () => void
  onRetry?: () => void
  requestId?: string | null
}

export const ErrorBanner: FC<ErrorBannerProps> = ({
  code,
  message,
  details,
  timestamp,
  onDismiss,
  onRetry,
  requestId,
}) => {
  const t = useTranslations(chatCopy)
  const tc = useTranslations(commonCopy)
  const { locale } = useLocale()
  const [isExpanded, setIsExpanded] = useState(false)
  const detailsId = useId()
  const errorMeta = getErrorMeta(code)

  const displayMessage =
    message || (errorMeta.messageKey ? t(errorMeta.messageKey) : errorMeta.defaultMessage)
  const displayTitle = errorMeta.titleKey ? t(errorMeta.titleKey) : errorMeta.title
  const variant = errorMeta.status === 'error' ? 'destructive' : errorMeta.status
  const StatusIcon = errorMeta.status === 'error' ? XCircle : AlertTriangle

  return (
    <div className="flex w-full flex-col gap-1">
      <Alert variant={variant} className="relative">
        <StatusIcon />
        <AlertTitle>{displayTitle}</AlertTitle>
        <AlertDescription>
          <span>
            {displayMessage}
            {details && (
              <>
                {' '}
                <button data-attr="chat-toggle-expanded"
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  aria-expanded={isExpanded}
                  aria-controls={detailsId}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-control border-none bg-transparent p-0 text-xs font-medium no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {isExpanded ? t('error.hideDetails') : t('error.showDetails')}
                  {isExpanded ? (
                    <ChevronUp className="size-3" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="size-3" aria-hidden="true" />
                  )}
                </button>
              </>
            )}
          </span>
          {/* The details open in place and fold back: landed in one frame, the
          card under the reader's pointer doubled its height at once. */}
          <AnimatePresence initial={false}>
            {isExpanded && details && (
              <HeightArrival key="details" className="w-full">
                <pre
                  id={detailsId}
                  className="text-error bg-surface-raised mt-2 max-h-48 w-full overflow-auto whitespace-pre-wrap rounded p-2 font-mono text-xs"
                >
                  {details}
                </pre>
              </HeightArrival>
            )}
          </AnimatePresence>
          {requestId && <RequestReference requestId={requestId} />}
          {onRetry && errorMeta.retryable !== false && (
            <div className="mt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetry}
                aria-label={t('error.retry')}
              >
                <RotateCw className="size-3.5" aria-hidden="true" />
                {t('error.retry')}
              </Button>
            </div>
          )}
        </AlertDescription>
        {onDismiss && (
          <button data-attr="chat-dismiss"
            type="button"
            onClick={onDismiss}
            aria-label={tc('actions.close')}
            className="text-muted-foreground hover:text-foreground duration-quick absolute right-3 top-3 rounded-control transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </Alert>

      {timestamp && (
        <span className="text-subtle mr-2 self-end text-xs">{formatTime(timestamp, locale)}</span>
      )}
    </div>
  )
}

const RequestReference: FC<{ requestId: string }> = ({ requestId }) => {
  const t = useTranslations(chatCopy)
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(requestId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-2 flex items-center gap-1.5" data-testid="error-request-id">
      <span className="text-subtle text-xs">{t('error.reference')}</span>
      <button data-attr="chat-copy"
        type="button"
        onClick={() => void handleCopy()}
        aria-label={t('error.referenceCopyAria', { id: requestId })}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-inline font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {shortRequestId(requestId)}
        {copied ? (
          <Check className="size-3" aria-hidden="true" />
        ) : (
          <Copy className="size-3" aria-hidden="true" />
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t('error.referenceCopied') : ''}
      </span>
    </div>
  )
}
