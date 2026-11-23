import type { JSX } from 'react'
import { CountPill } from '@/components/ui/count-pill'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { effectiveAction } from '../../lib/effective-action'
import type { FolderUploadPlan, PlannedFile } from '../../lib/folder-upload-plan'

export function PlanDetails({
  plan,
  includeUpdates,
}: {
  plan: FolderUploadPlan
  includeUpdates: boolean
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const rows = plan.files
  if (rows.length === 0) return null

  return (
    <details className="rounded-surface border" data-testid="folder-upload-details">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground pointer-coarse:py-3">
        {t('folderUpload.showAll', { count: rows.length })}
      </summary>
      <ul className="space-y-0.5 px-3 pb-3">
        {rows.map((file, index) => (
          <li key={`${index}:${file.originPath}`} className="flex min-w-0 items-center gap-2 text-xs">
            <ActionTag file={file} includeUpdates={includeUpdates} />
            <MiddleTruncate text={file.originPath} tail={24} className="min-w-0 flex-1 font-mono text-muted-foreground" />
            {/* The document this row is about to touch, when the project
                calls it something else — a rename here is invisible to the
                drop, and approving a replacement you cannot locate is not
                approval. */}
            {file.existingName && (
              <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">
                {t('folderUpload.alreadyHereAs', { name: file.existingName })}
              </span>
            )}
            {file.existingArchived && <span className="shrink-0 text-muted-foreground">{t('folderUpload.archivedMatch')}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}

function ActionTag({ file, includeUpdates }: { file: PlannedFile; includeUpdates: boolean }): JSX.Element {
  const t = useTranslations(filesCopy)
  const effective = effectiveAction(file, includeUpdates)
  return (
    <CountPill
      tone={effective === 'new' || effective === 'revision' ? 'attention' : 'muted'}
      className="min-w-[5.5rem]"
      data-testid={`folder-upload-action-${effective}`}
    >
      {t(`folderUpload.action.${effective}`)}
    </CountPill>
  )
}
