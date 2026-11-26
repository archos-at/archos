import type { JSX } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { PlannedFile } from '../../lib/folder-upload-plan'
import type { SentConflictChoice } from '../../lib/name-conflict'

export function SingleNotes({ single }: { single: PlannedFile }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  if (!single.existingArchived) return null
  return (
    <div className="space-y-2 pb-1">
      <Alert data-testid="folder-upload-archived">
        <AlertDescription>{t('folderUpload.single.archived')}</AlertDescription>
      </Alert>
    </div>
  )
}

export function SingleFooter({
  file,
  busy,
  canChange,
  onCancel,
  onAnswer,
}: {
  file: PlannedFile
  busy: boolean
  canChange: boolean
  onCancel: () => void
  onAnswer: (choice: SentConflictChoice) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        {t('folderUpload.cancel')}
      </Button>
      <Button
        variant="secondary"
        onClick={() => onAnswer('keep_both')}
        disabled={busy || !canChange}
        title={t('nameConflicts.keepBothAs', { name: file.conflict?.keepBothAs ?? file.file.name })}
        data-testid="folder-upload-keep-both"
      >
        {t('nameConflicts.keepBoth')}
      </Button>
      <Button onClick={() => onAnswer('replace')} disabled={busy} data-testid="folder-upload-confirm">
        {busy && <Spinner size="sm" />}
        {t('folderUpload.single.confirmRevision')}
      </Button>
    </>
  )
}
