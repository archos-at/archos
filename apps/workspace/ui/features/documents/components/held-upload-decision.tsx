'use client'

/**
 * What the person who just met a held upload can do about it, where they meet
 * it (ADR-0086): the upload tray's row and the upload summary.
 *
 * A check is wrong sometimes: an order number reads like a card number. The one
 * who may decide about the file (a reviewer, `canReview`, often the uploader
 * themselves in a small office) allows it here, after the same question the
 * Quarantäne list asks, instead of being sent to that list for a file they are
 * looking at. The uploader who may not decide asks those who may. Which of the
 * two is the server's answer (`GET /api/documents/{id}/quarantine`), never a
 * role read here; until it lands, and for anyone else, nothing is offered.
 */

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
  /** The held document. */
  documentId: string
  /** The name the dialog and the toasts say. */
  name: string
  /** The file was allowed and sent to be read, with this status. */
  onReleased?: (status: string) => void
  /**
   * Open the file at its findings, where the surface can: deciding whether
   * `4111 …` is a card number takes seeing it, which the masked sample hides.
   */
  onView?: () => void
  className?: string
  /** The test ids of the two buttons. */
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
  // `failed`: the question could not be asked, which is not a no; a retry asks again.
  const [access, setAccess] = useState<QuarantineReviewAccess | 'failed' | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [released, setReleased] = useState(false)
  // Someone else allowed or deleted it first: nothing is left to decide here.
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
      // Someone else allowed or deleted it first: what was on screen was stale.
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
        variant="ghost"
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
          variant="ghost"
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
