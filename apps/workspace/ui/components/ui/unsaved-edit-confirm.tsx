'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'

export function useUnsavedEditGuard({
  dirty,
  onOpenChange,
}: {
  dirty: boolean
  onOpenChange: (open: boolean) => void
}): { onOpenChange: (open: boolean) => void; question: JSX.Element } {
  const [asking, setAsking] = useState(false)
  const guarded = (next: boolean): void => {
    if (next || !dirty) {
      onOpenChange(next)
      return
    }
    setAsking(true)
  }
  return {
    onOpenChange: guarded,
    question: (
      <UnsavedEditConfirm
        open={asking}
        onOpenChange={setAsking}
        onConfirm={() => {
          setAsking(false)
          onOpenChange(false)
        }}
      />
    ),
  }
}

export function UnsavedEditConfirm({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): JSX.Element {
  const t = useTranslations(commonCopy)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      title={t('unsavedEdit.title')}
      description={t('unsavedEdit.text')}
      confirmLabel={t('unsavedEdit.confirm')}
      cancelLabel={t('unsavedEdit.keep')}
      onConfirm={onConfirm}
      confirmTestId="unsaved-edit-confirm"
    />
  )
}
