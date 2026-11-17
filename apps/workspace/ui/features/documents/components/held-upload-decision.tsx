'use client'

import { useEffect, useState, type JSX } from 'react'
import { Eye, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'

import { ApiRequestError } from '@/adapters/api/api-error'
import {
  getQuarantineReviewAccess,
  releaseQuarantinedDocument,
  type QuarantineReviewAccess,
} from '@/adapters/api/upload-screening-client'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { uploadBatchesCopy } from '@/i18n/namespaces/upload-batches'
import { notifyDocumentsChanged } from '@/lib/documents/document-changes'
import { cn } from '@/lib/utils'
import { RequestReviewButton } from './request-review-button'

export interface HeldUploadDecisionProps {
  documentId: string
  name: string
  onReleased?: (status: string) => void
  onView?: () => void
  className?: string
  askTestId: string
  allowTestId: string
}

export function HeldUploadDecision({
  documentId,
  name,
  onReleased,
  onView,
  className,
  askTestId,
  allowTestId,
}: HeldUploadDecisionProps): JSX.Element | null {
  const t = useTranslations(uploadBatchesCopy)
  const tOrg = useTranslations(organizationCopy)
  const tc = useTranslations(commonCopy)
  const [access, setAccess] = useState<QuarantineReviewAccess | 'failed' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [released, setReleased] = useState(false)
  const [decidedElsewhere, setDecidedElsewhere] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getQuarantineReviewAccess(documentId, controller.signal)
      .then(setAccess)
      .catch(() => {
        if (!controller.signal.aborted) setAccess('failed')
      })
    return () => controller.abort()
  }, [documentId, attempt])

  const release = async (): Promise<void> => {
    try {
      const { status } = await releaseQuarantinedDocument(documentId)
      setReleased(true)
      notifyDocumentsChanged()
      toast.success(tOrg('quarantine.released', { name }))
      onReleased?.(status)
    } catch (error) {
      const decided =
        error instanceof ApiRequestError && (error.status === 409 || error.status === 404)
      if (decided) {
        notifyDocumentsChanged()
        setDecidedElsewhere(true)
      }
      toast.error(decided ? tOrg('quarantine.changed') : tOrg('quarantine.releaseError'))
    }
  }

  if (released) {
    return (
      <p
        className={cn('text-muted-foreground text-xs leading-snug', className)}
        data-testid={`${allowTestId}-done`}
      >
        {t('summary.files.allowedAnyway')}
      </p>
    )
  }
  if (decidedElsewhere) return null
  if (access === 'failed') {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={className}
        onClick={() => {
          setAccess(null)
          setAttempt((count) => count + 1)
        }}
        data-testid={`${allowTestId}-retry`}
      >
        {tc('actions.retry')}
      </Button>
    )
  }
  if (access?.canAskForReview) {
    return (
      <RequestReviewButton
        documentId={documentId}
        name={name}
        className={className}
        testId={askTestId}
      />
    )
  }
  if (!access?.canReview) return null

  return (
    <>
      {onView && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={className}
          onClick={onView}
          data-testid={`${allowTestId}-view`}
        >
          <Eye className="size-4" aria-hidden />
          {t('summary.files.viewFinding')}
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={className}
        onClick={() => setConfirmOpen(true)}
        data-testid={allowTestId}
      >
        <ShieldCheck className="size-4" aria-hidden />
        {t('summary.files.allowAnyway')}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('summary.files.allowAnywayTitle', { name })}
        description={t('summary.files.allowAnywayDescription')}
        confirmLabel={t('summary.files.allowAnyway')}
        cancelLabel={tc('actions.cancel')}
        tone="warning"
        icon={ShieldOff}
        confirmTestId={`${allowTestId}-confirm`}
        onConfirm={release}
      />
    </>
  )
}
