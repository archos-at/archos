'use client'

import type { JSX, RefObject } from 'react'
import { useEffect, useId, useMemo, useState } from 'react'
import { Folder, FolderInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUnsavedEditGuard } from '@/components/ui/unsaved-edit-confirm'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { DOCUMENT_TYPE_TAGS, tagLabel, type DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import { INBOUND_MAIL_FILE_NAME_MAX, type InboundMailPartView } from '@/lib/inbound-mail/inbound-mail-wire'
import { FolderPickerSheet } from '@/features/documents'
import { NewMark } from '@/components/ui/filing-chip'
import { targetForPath, type AttachmentDraft, type FolderOption, type FolderTarget } from '../lib/draft'
import { PlaceFact } from './inbound-mail-atoms'
import { filesCopy } from '@/i18n/namespaces/files'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const NO_TYPE = 'none'

export interface AttachmentTargetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  part: InboundMailPartView
  draft: AttachmentDraft
  folders?: readonly FolderOption[]
  onApply: (change: Pick<AttachmentDraft, 'name' | 'documentType' | 'revisionOf'> & { folder?: FolderTarget | null }) => void
  /** Opened from a press, not a `DialogTrigger`: closing hands the focus back to that press, never to the page. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function AttachmentTargetDialog({ open, onOpenChange, part, draft, folders = [], onApply, returnFocusRef }: AttachmentTargetDialogProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const tFiles = useTranslations(filesCopy)
  const nameId = useId()
  const [name, setName] = useState(draft.name)
  const [documentType, setDocumentType] = useState<DocumentTypeTag | null>(draft.documentType)
  const [revisionOf, setRevisionOf] = useState<string | null>(draft.revisionOf)
  const [folder, setFolder] = useState<FolderTarget | null>(draft.folder)
  const [pickerOpen, setPickerOpen] = useState(false)
  const destinations = useMemo(
    () =>
      folders
        .filter((option) => option.writable)
        .map((option) => ({ folder: { id: option.id, name: option.name, parentId: option.parentId }, label: option.path.split('/').join(' / ') })),
    [folders]
  )

  useEffect(() => {
    if (!open) return
    setName(draft.name)
    setDocumentType(draft.documentType)
    setRevisionOf(draft.revisionOf)
    setFolder(draft.folder)
  }, [open, draft.name, draft.documentType, draft.revisionOf, draft.folder])

  const candidate = part.revisionCandidate
  const trimmed = name.trim()
  const appliedFolder = revisionOf !== null && candidate ? targetForPath(candidate.folderPath ?? '', folders) : folder
  const folderChanged = (appliedFolder?.path ?? null) !== (draft.folder?.path ?? null)
  const changed = trimmed !== draft.name || documentType !== draft.documentType || revisionOf !== draft.revisionOf || folderChanged

  const guard = useUnsavedEditGuard({ dirty: changed, onOpenChange })

  const apply = (): void => {
    if (trimmed === '') return
    onApply({ name: trimmed, documentType, revisionOf, ...(folderChanged ? { folder: appliedFolder } : {}) })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={guard.onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        closeLabel={t('target.cancel')}
        data-testid="attachment-target-dialog"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{t('target.title', { name: part.filename ?? draft.name })}</DialogTitle>
          <DialogDescription className="sr-only">{t('target.title', { name: part.filename ?? draft.name })}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <Field>
            <FieldLabel htmlFor={nameId}>{t('target.name')}</FieldLabel>
            <Input
              id={nameId}
              value={name}
              maxLength={INBOUND_MAIL_FILE_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              className="pointer-coarse:text-base"
              aria-invalid={trimmed === '' || undefined}
            />
          </Field>
          <div className="flex flex-col gap-1.5" data-testid="attachment-target-folder">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <PlaceFact icon={Folder} label={t('target.folder')}>
                {appliedFolder === null ? t('target.noFolder') : appliedFolder.path === '' ? t('suggestion.root') : appliedFolder.path}
                {appliedFolder?.kind === 'new' && <NewMark className="ml-1.5 align-[1px]">{t('suggestion.newFolder')}</NewMark>}
              </PlaceFact>
              {revisionOf === null && destinations.length > 0 && (
                <Button type="button" size="sm" variant="secondary" className="px-2.5 text-xs" onClick={() => setPickerOpen(true)} data-testid="attachment-target-folder-pick">
                  <FolderInput className="size-3.5" aria-hidden />
                  {t('target.otherFolder')}
                </Button>
              )}
            </div>
            {revisionOf !== null && <p className="text-muted-foreground text-xs">{t('target.revisionFolder')}</p>}
          </div>
          <Field>
            <FieldLabel>{t('target.documentType')}</FieldLabel>
            <Select
              value={documentType ?? NO_TYPE}
              onValueChange={(value) => setDocumentType(value === NO_TYPE ? null : (value as DocumentTypeTag))}
            >
              <SelectTrigger aria-label={t('target.documentType')} className="pointer-coarse:text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TYPE}>{t('target.noDocumentType')}</SelectItem>
                {DOCUMENT_TYPE_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tagLabel(tag, tFiles)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {candidate && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('target.revision')}</legend>
              <RadioGroup value={revisionOf ?? NO_TYPE} onValueChange={(value) => setRevisionOf(value === NO_TYPE ? null : value)}>
                <div className="flex items-center gap-2 pointer-coarse:min-h-11">
                  <RadioGroupItem id={`${nameId}-new`} value={NO_TYPE} />
                  <Label htmlFor={`${nameId}-new`} className="font-normal">
                    {t('target.newDocument')}
                  </Label>
                </div>
                <div className="flex items-center gap-2 pointer-coarse:min-h-11">
                  <RadioGroupItem id={`${nameId}-revision`} value={candidate.documentId} />
                  <Label htmlFor={`${nameId}-revision`} className="font-normal [overflow-wrap:anywhere]">
                    {t('target.revisionOf', { version: candidate.nextVersion, name: candidate.name })}
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('target.cancel')}
            </Button>
            <Button type="submit" disabled={trimmed === '' || !changed} data-testid="attachment-target-apply">
              {t('target.apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {guard.question}
      <FolderPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={t('target.folderPickerTitle')}
        destinations={destinations}
        currentFolderId={folder?.kind === 'existing' ? folder.folderId : undefined}
        onPick={(folderId) => {
          setPickerOpen(false)
          const option = folderId ? folders.find((candidate) => candidate.id === folderId) : null
          setFolder(option ? targetForPath(option.path, folders, option.id) : targetForPath('', folders))
        }}
      />
    </Dialog>
  )
}
