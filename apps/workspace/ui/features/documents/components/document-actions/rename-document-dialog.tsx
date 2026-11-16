'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  composeDocumentName,
  documentDisplayName,
  splitDocumentName,
  validateDocumentName,
  type DocumentNameError,
} from '@/lib/documents/display-name'
import type { ActionableDocument } from './use-document-actions'
import { DOCUMENT_SCOPE_COPY, type DocumentScope } from './document-scope'

export interface RenameDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: ActionableDocument
  scope: DocumentScope
  onRename: (displayName: string | null) => Promise<boolean>
  pending?: boolean
}

export function RenameDocumentDialog({
  open,
  onOpenChange,
  document,
  scope,
  onRename,
  pending = false,
}: RenameDocumentDialogProps) {
  const t = useTranslations(DOCUMENT_SCOPE_COPY[scope])
  const currentName = documentDisplayName(document)
  const { stem, extension } = splitDocumentName(currentName)
  const [value, setValue] = useState(stem)
  const [error, setError] = useState<DocumentNameError | null>(null)

  useEffect(() => {
    if (!open) return
    setValue(stem)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, document.id])

  const nextName = composeDocumentName(value, currentName)
  const unchanged = nextName === currentName
  const isRenamed = currentName !== document.filename

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const validated = validateDocumentName(nextName)
    if (!validated.ok) {
      setError(validated.reason)
      return
    }
    if (unchanged) {
      onOpenChange(false)
      return
    }
    if (await onRename(validated.value)) onOpenChange(false)
  }

  const handleRestore = async () => {
    if (pending) return
    if (await onRename(null)) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-base leading-snug">{t('rename.title')}</DialogTitle>
            <DialogDescription>{t('rename.description')}</DialogDescription>
          </DialogHeader>

          <Field className="mt-4">
            <FieldLabel htmlFor="document-rename-input">{t('rename.label')}</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="document-rename-input"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                enterKeyHint="done"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={pending}
                aria-invalid={error !== null}
                aria-describedby={error ? 'document-rename-error' : 'document-rename-hint'}
                className="flex-1"
              />
              {extension !== '' && (
                <span
                  className="shrink-0 rounded-inline bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
                  data-testid="rename-extension"
                >
                  {extension}
                </span>
              )}
            </div>
            {error ? (
              <FieldError id="document-rename-error">{t(`rename.errors.${error}`)}</FieldError>
            ) : (
              <FieldDescription id="document-rename-hint">{t('rename.hint')}</FieldDescription>
            )}
          </Field>

          <DialogFooter className="mt-5">
            {/* Recovery sits with the other controls rather than in a menu one
                level up: the person who wants the original name back is already
                looking at the field that took it away. */}
            {isRenamed && (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                onClick={() => void handleRestore()}
                disabled={pending}
              >
                {t('rename.restore')}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              {t('rename.cancel')}
            </Button>
            <Button type="submit" disabled={pending || value.trim() === ''} data-testid="rename-submit">
              {pending ? t('rename.saving') : t('rename.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
