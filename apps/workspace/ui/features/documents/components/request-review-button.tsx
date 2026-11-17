'use client'

import { useState, type JSX } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { toast } from 'sonner'

import { requestQuarantineRelease } from '@/adapters/api/upload-screening-client'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { uploadBatchesCopy } from '@/i18n/namespaces/upload-batches'

export interface RequestReviewButtonProps {
  documentId: string
  name: string
  className?: string
  testId?: string
}

export function RequestReviewButton({
  documentId,
  name,
  className,
  testId = `request-review-${documentId}`,
}: RequestReviewButtonProps): JSX.Element {
  const t = useTranslations(uploadBatchesCopy)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const ask = async (): Promise<void> => {
    setState('sending')
    try {
      const { notified } = await requestQuarantineRelease(documentId)
      setState('sent')
      if (notified > 0) toast.success(t('summary.files.releaseRequestedToast', { name }))
      else toast.info(t('summary.files.releaseRequestNobody', { name }))
    } catch {
      setState('idle')
      toast.error(t('summary.files.releaseRequestError'))
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      disabled={state !== 'idle'}
      loading={state === 'sending'}
      onClick={() => void ask()}
      data-testid={testId}
    >
      <ShieldQuestion className="size-4" aria-hidden />
      {state === 'sent' ? t('summary.files.releaseRequested') : t('summary.files.requestRelease')}
    </Button>
  )
}
