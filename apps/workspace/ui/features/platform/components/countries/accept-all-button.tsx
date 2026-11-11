'use client'

/**
 * Accept every open claim of one change request at once, source checked: the
 * person ticks that they compared every source, then confirms. Claims that
 * already have a verdict stay as they are; approving is still its own step.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { AcceptAllReceipt } from '@/lib/base-knowledge/platform/wire'

export function AcceptAllButton({ requestId, onDone }: { requestId: string; onDone: () => void }): JSX.Element {
  const t = useTranslations(platformCopy)
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState(false)

  const accept = async (): Promise<void> => {
    const response = await fetch(`/api/platform/knowledge/change-requests/${requestId}/review/accept-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceChecked: checked }),
    }).catch(() => null)
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: string } | null
      toast.error(t('countryKnowledge.failed', { reason: body?.error ?? String(response?.status ?? '') }))
      // The dialog stays open on a refusal, with the reason in the toast.
      throw new Error('refused')
    }
    const receipt = (await response.json()) as AcceptAllReceipt
    toast.success(t('countryPages.review.acceptAll.done', { accepted: receipt.accepted, records: receipt.records }))
    onDone()
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => (setChecked(false), setOpen(true))} data-testid={`accept-all-${requestId}`}>
        <CheckCheck aria-hidden />
        {t('countryPages.review.acceptAll.button')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('countryPages.review.acceptAll.title')}
        description={t('countryPages.review.acceptAll.body')}
        confirmLabel={t('countryPages.review.acceptAll.button')}
        cancelLabel={t('countryKnowledge.cancel')}
        tone="default"
        confirmDisabled={!checked}
        confirmTestId="accept-all-confirm"
        onConfirm={accept}
      >
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={checked} onCheckedChange={(next) => setChecked(next === true)} className="mt-0.5" data-testid="accept-all-source-checked" />
          <span>{t('countryPages.review.acceptAll.sourceChecked')}</span>
        </label>
      </ConfirmDialog>
    </>
  )
}
