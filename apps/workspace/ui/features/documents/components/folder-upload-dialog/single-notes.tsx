import type { JSX } from 'react'
import { MoveRight } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { PlannedFile } from '../../lib/folder-upload-plan'

export function SingleNotes({ single, destination }: { single: PlannedFile; destination: string }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const moves = single.refiledFromFolderId !== undefined
  if (!moves && !single.existingArchived) return null
  return (
    <div className="space-y-2 pb-1">
      {single.existingArchived && (
        <Alert data-testid="folder-upload-archived">
          <AlertDescription>{t('folderUpload.single.archived')}</AlertDescription>
        </Alert>
      )}
      {moves && (
        <Alert data-testid="folder-upload-refiled">
          <MoveRight aria-hidden />
          <AlertDescription>{t('folderUpload.single.refiled', { folder: destination })}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
