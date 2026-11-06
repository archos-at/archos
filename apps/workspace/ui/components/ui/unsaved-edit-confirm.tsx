'use client'

/**
 * The question an editor asks before it is left with unsaved changes
 * (`design-language.md`, „Getting back out“): Escape, the X and a scrim click
 * all route here, so a stray press never throws an edit away. A clean editor
 * closes like any other overlay; the question is about the unsaved edit, not
 * about the dialog.
 *
 * `useUnsavedEditGuard` gives the editor's `Dialog` its `onOpenChange` and the
 * question to render beside it. An explicit „Abbrechen“ in the editor's own
 * footer is the reader saying it; it closes without asking.
 *
 * The words are shared (`common.unsavedEdit`) and never „verwerfen“, which in
 * the E-Mail-Eingang says no to a whole mail.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'

export function useUnsavedEditGuard({
  dirty,
  onOpenChange,
}: {
  /** Something was changed since the editor opened. */
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
