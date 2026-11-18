import type { JSX } from 'react'
import { AlertTriangle, Copy, FilePlus2, FolderPlus, MoveRight, RefreshCw, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { StatCardIcon, type StatCardIconTone } from '@/components/ui/stat-card'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { FolderUploadCounts, FolderUploadPlan, PlannedFile } from '../../lib/folder-upload-plan'
import type { RevisionChange } from '../../lib/revision-proposals'
import { PlanDetails } from './plan-details'
import { RevisionSection } from './revision-section'
import { ScreeningSection } from './screening-section'

export function BatchPlan({
  plan,
  counts,
  isFolder,
  includeUpdates,
  onIncludeUpdatesChange,
  pending,
  destination,
  onReleaseChange,
  onRevisionChange,
}: {
  plan: FolderUploadPlan
  counts: FolderUploadCounts
  isFolder: boolean
  includeUpdates: boolean
  onIncludeUpdatesChange: (include: boolean) => void
  pending: boolean
  destination: string
  onReleaseChange?: (file: File, released: boolean) => void
  onRevisionChange?: (change: RevisionChange) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div className="space-y-4 pb-4">
      {/* Two by two at every width: stacked one per row on a phone, the four
          numbers pushed the decision off the first screen. */}
      <div className="grid grid-cols-2 gap-2">
        <PlanCount icon={FilePlus2} tone="success" count={counts.new} label={t('folderUpload.counts.new')} testId="folder-upload-count-new" />
        <PlanCount
          icon={RefreshCw}
          tone="warning"
          count={counts.update}
          label={t('folderUpload.counts.update')}
          testId="folder-upload-count-update"
        />
        <PlanCount
          icon={ShieldCheck}
          tone="muted"
          count={counts.unchanged}
          label={t('folderUpload.counts.unchanged')}
          testId="folder-upload-count-unchanged"
        />
        {isFolder && (
          <PlanCount
            icon={FolderPlus}
            tone="info"
            count={counts.foldersCreated}
            label={t('folderUpload.counts.foldersCreated')}
            testId="folder-upload-count-folders"
            secondary={
              counts.foldersMatched > 0 ? t('folderUpload.counts.foldersMatched', { count: counts.foldersMatched }) : undefined
            }
          />
        )}
      </div>

      {/* The decision comes right after the numbers: it is what the reader is here for. */}
      <RevisionSection
        plan={plan}
        updates={counts.update}
        includeUpdates={includeUpdates}
        onIncludeUpdatesChange={onIncludeUpdatesChange}
        pending={pending}
        destination={destination}
        onRevisionChange={onRevisionChange}
      />

      {/* Where documents END UP, which is the part a reader does not see
          coming: the document exists, it is simply filed somewhere else,
          and this drop puts it where its tree says it belongs. */}
      {(counts.refiled > 0 || counts.moving > 0) && (
        <Alert data-testid="folder-upload-refiled">
          <MoveRight aria-hidden />
          <AlertDescription className="space-y-1">
            {counts.refiled > 0 && <span className="block">{t('folderUpload.refiled', { count: counts.refiled })}</span>}
            {/* The unchanged ones send no bytes, so nothing about the
                upload would move them — they are moved on their own, and
                that is a different sentence. */}
            {counts.moving > 0 && <span className="block">{t('folderUpload.moving', { count: counts.moving })}</span>}
          </AlertDescription>
        </Alert>
      )}

      {/* ALREADY HERE UNDER ANOTHER NAME.
          Not an update — the server replaces by filename and these do not
          share one, so uploading would add a second copy of a document
          the project already holds. Named with what it is called here,
          because that is the only way the reader can go and look. */}
      {counts.duplicate > 0 && (
        <Alert variant="warning" data-testid="folder-upload-duplicates">
          <Copy aria-hidden />
          <AlertTitle>{t('folderUpload.duplicates', { count: counts.duplicate })}</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">{t('folderUpload.duplicatesExplain')}</span>
            <FileNameList files={plan.files.filter((file) => file.action === 'duplicate')} />
          </AlertDescription>
        </Alert>
      )}

      {/* THE ONE THING THAT IS NOT MERELY INFORMATION.
          A project holds one document per filename, so two files of the
          same name inside one drop cannot both land — and before this
          they both uploaded, one overwriting the other, with nothing said.
          Neither is sent; the reader is told which, so they can rename or
          pick. */}
      {counts.collision > 0 && (
        <Alert variant="warning" data-testid="folder-upload-collisions">
          <AlertTriangle aria-hidden />
          <AlertTitle>{t('folderUpload.collisions', { count: counts.collision })}</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">{t('folderUpload.collisionsExplain')}</span>
            <FileNameList files={plan.files.filter((file) => file.action === 'collision')} />
          </AlertDescription>
        </Alert>
      )}

      <ScreeningSection plan={plan} pending={pending} onReleaseChange={onReleaseChange} />

      <PlanDetails plan={plan} includeUpdates={includeUpdates} />
    </div>
  )
}

function PlanCount({
  icon,
  tone,
  count,
  label,
  secondary,
  testId,
}: {
  icon: LucideIcon
  tone: StatCardIconTone
  count: number
  label: string
  secondary?: string
  testId: string
}): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-surface border p-2.5', count === 0 && 'opacity-55')} data-testid={testId}>
      <StatCardIcon icon={icon} tone={tone} size="sm" />
      <div className="min-w-0">
        <p className="text-sm font-medium tabular-nums text-foreground">{count}</p>
        <p className="text-xs leading-snug text-muted-foreground">{label}</p>
        {secondary && <p className="text-[11px] leading-snug text-muted-foreground">{secondary}</p>}
      </div>
    </div>
  )
}

function FileNameList({ files }: { files: readonly PlannedFile[] }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {files.slice(0, 6).map((file, index) => (
        <li key={`${index}:${file.originPath}`} className="truncate opacity-90">
          <span className="font-mono">{file.originPath}</span>
          {file.existingName && (
            <span className="opacity-80"> — {t('folderUpload.alreadyHereAs', { name: file.existingName })}</span>
          )}
          {file.existingArchived && <span className="opacity-80"> ({t('folderUpload.archivedMatch')})</span>}
        </li>
      ))}
      {files.length > 6 && <li className="opacity-70">+{files.length - 6}</li>}
    </ul>
  )
}
