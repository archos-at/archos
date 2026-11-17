import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { describeNameMatch } from '@/lib/upload-screening/quarantine'
import type { FolderUploadPlan } from '../../lib/folder-upload-plan'

export function ScreeningSection({
  plan,
  pending,
  onReleaseChange,
}: {
  plan: FolderUploadPlan
  pending: boolean
  onReleaseChange?: (file: File, released: boolean) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const screened = plan.files.filter((file) => file.action === 'excluded' || file.screeningReleased)
  if (screened.length === 0) return null
  const excludedCount = screened.filter((file) => file.action === 'excluded').length
  return (
    <Alert variant="warning" data-testid="folder-upload-excluded">
      <ShieldAlert aria-hidden />
      <AlertTitle>{t('folderUpload.excluded', { count: excludedCount })}</AlertTitle>
      <AlertDescription className="space-y-2">
        <span className="block">{t('folderUpload.excludedExplain')}</span>
        <ul className="space-y-1.5 text-xs">
          {screened.slice(0, 20).map((file, index) => (
            <li key={`${index}:${file.originPath}`} className="flex items-start gap-2">
              {onReleaseChange && (
                <Checkbox
                  checked={file.screeningReleased === true}
                  onCheckedChange={(checked) => onReleaseChange(file.file, checked === true)}
                  disabled={pending}
                  aria-label={`${t('folderUpload.releaseFile')}: ${file.originPath}`}
                  data-testid="folder-upload-release"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono">{file.originPath}</span>
                <span className="block opacity-80">
                  {(file.screening ?? []).map((match) => describeNameMatch(match, t)).join(' · ')}
                </span>
              </span>
            </li>
          ))}
          {screened.length > 20 && <li className="opacity-70">+{screened.length - 20}</li>}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
