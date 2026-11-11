'use client'

/**
 * One change request opened over the page it was listed on: the review with
 * every claim beside its source, the texts of its editions, and its next step
 * (`ChangeRequestReview`). Read-only staff see it without the write controls.
 */

import type { JSX } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { usePlatformCan } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { ChangeRequestReview } from '../change-request-review'

export function ChangeRequestDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string | null
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const canManage = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeReview)
  return (
    <Dialog open={id !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl" fullScreenOnMobile closeLabel={t('countryKnowledge.close')}>
        {id ? <ChangeRequestReview id={id} canManage={canManage} onChanged={onChanged} /> : null}
      </DialogContent>
    </Dialog>
  )
}
