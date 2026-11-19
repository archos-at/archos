'use client'

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { FolderInput } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'
import { FolderPickerSheet } from '@/features/documents'
import { useTranslations } from '@/i18n'
import { targetForPath, type FolderOption, type FolderTarget } from '../lib/draft'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

/** „Anhänge“ with, for a plan set, one press that ticks them all and one that sends the ticked ones to one folder. */
export function AttachmentsHeading({
  bulk,
  selectable,
  checked,
  folders,
  onCheckAll,
  onFileCheckedInto,
}: {
  bulk: boolean
  selectable: number
  checked: number
  folders: readonly FolderOption[]
  onCheckAll: (checked: boolean) => void
  onFileCheckedInto: (target: FolderTarget) => void
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [pickerOpen, setPickerOpen] = useState(false)
  const allChecked = selectable > 0 && checked === selectable
  const destinations = useMemo(
    () =>
      folders
        .filter((folder) => folder.writable)
        .map((folder) => ({ folder: { id: folder.id, name: folder.name, parentId: folder.parentId }, label: folder.path.split('/').join(' / ') })),
    [folders]
  )
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="attachments-header">
      <SectionLabel as="h3" className="mr-auto">
        {t('attachments.label')}
      </SectionLabel>
      {bulk && (
        <>
          <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite" data-testid="attachments-selected-count">
            {t('attachments.selectedCount', { checked, count: selectable })}
          </span>
          <Button type="button" variant="secondary" size="sm" className="px-2.5 text-xs pointer-coarse:h-11" onClick={() => onCheckAll(!allChecked)} data-testid="attachments-check-all">
            {allChecked ? t('attachments.uncheckAll') : t('attachments.checkAll')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="px-2.5 text-xs pointer-coarse:h-11"
            disabled={checked === 0}
            onClick={() => setPickerOpen(true)}
            data-testid="attachments-file-checked-into"
          >
            <FolderInput className="size-3.5" aria-hidden />
            {t('attachments.fileCheckedInto')}
          </Button>
          <FolderPickerSheet
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            title={t('attachments.fileCheckedIntoTitle', { count: checked })}
            destinations={destinations}
            onPick={(folderId) => {
              setPickerOpen(false)
              const folder = folderId ? folders.find((option) => option.id === folderId) : null
              onFileCheckedInto(folder ? targetForPath(folder.path, folders, folder.id) : targetForPath('', folders))
            }}
          />
        </>
      )}
    </div>
  )
}
