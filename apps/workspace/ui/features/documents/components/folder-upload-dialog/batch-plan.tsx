import type { JSX } from 'react'
import { useMemo } from 'react'
import { FilePlus2, FolderPlus, Files, RefreshCw, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { StatCardIcon, type StatCardIconTone } from '@/components/ui/stat-card'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import type { FolderUploadCounts, FolderUploadPlan } from '../../lib/folder-upload-plan'
import type { ConflictRow } from '../../lib/name-conflict'
import type { RevisionChange } from '../../lib/revision-proposals'
import type { ConflictChange } from '../../hooks/use-upload-decision'
import { NameConflictList } from '../name-conflict/name-conflict-list'
import { DecisionNote, DecisionSection } from '../upload-decision-atoms'
import { PlanDetails } from './plan-details'
import { RevisionSection } from './revision-section'
import { ScreeningSection } from './screening-section'

export function BatchPlan({
  plan,
  counts,
  isFolder,
  pending,
  destination,
  onReleaseChange,
  onRevisionChange,
  onConflictChange,
}: {
  plan: FolderUploadPlan
  counts: FolderUploadCounts
  isFolder: boolean
  pending: boolean
  destination: string
  onReleaseChange?: (file: File, released: boolean) => void
  onRevisionChange?: (change: RevisionChange) => void
  onConflictChange?: (change: ConflictChange) => void
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
      <ConflictSection plan={plan} pending={pending} onConflictChange={onConflictChange} />

      <RevisionSection plan={plan} pending={pending} destination={destination} onRevisionChange={onRevisionChange} />

      <ScreeningSection plan={plan} pending={pending} onReleaseChange={onReleaseChange} />

      <PlanDetails plan={plan} />
    </div>
  )
}

function ConflictSection({
  plan,
  pending,
  onConflictChange,
}: {
  plan: FolderUploadPlan
  pending: boolean
  onConflictChange?: (change: ConflictChange) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const rows = useMemo<ConflictRow[]>(
    () =>
      plan.files.flatMap((file, index) =>
        file.conflict
          ? [
              {
                key: String(index),
                path: file.originPath,
                name: file.file.name,
                existingName: file.existingName,
                within: file.conflict.within,
                choice: file.conflict.choice,
                keepBothAs: file.conflict.keepBothAs,
              },
            ]
          : []
      ),
    [plan.files]
  )
  if (rows.length === 0) return null
  const held = rows.filter((row) => row.within === 'folder').length
  const inDrop = rows.length - held
  return (
    <DecisionSection icon={Files} title={t('folderUpload.conflicts.title', { count: rows.length })} data-testid="folder-upload-conflicts">
      {held > 0 && <DecisionNote>{t('folderUpload.conflicts.heldNote', { count: held })}</DecisionNote>}
      {inDrop > 0 && <DecisionNote>{t('folderUpload.conflicts.dropNote', { count: inDrop })}</DecisionNote>}
      <NameConflictList
        rows={rows}
        operation="upload"
        disabled={pending}
        onChoose={
          onConflictChange
            ? (keys, choice) => onConflictChange({ files: keys.map((key) => plan.files[Number(key)].file), choice })
            : undefined
        }
      />
    </DecisionSection>
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
