import type { JSX } from 'react'
import { useMemo } from 'react'
import { History } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FolderUploadPlan } from '../../lib/folder-upload-plan'
import {
  groupByFolder,
  groupRevisionProposals,
  masterTarget,
  type RevisionChange,
  type RevisionProposals,
} from '../../lib/revision-proposals'
import {
  DecisionBar,
  DecisionFileName,
  DecisionGroupLabel,
  DecisionNote,
  DecisionRow,
  DecisionRowExtra,
  DecisionSection,
  DecisionSubgroup,
  DecisionTarget,
} from '../upload-decision-atoms'
import { CandidatePick, ProposalBox } from './revision-controls'

export function RevisionSection({
  plan,
  updates,
  includeUpdates,
  onIncludeUpdatesChange,
  pending,
  destination,
  onRevisionChange,
}: {
  plan: FolderUploadPlan
  updates: number
  includeUpdates: boolean
  onIncludeUpdatesChange: (include: boolean) => void
  pending: boolean
  destination: string
  onRevisionChange?: (change: RevisionChange) => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const proposals = useMemo(() => groupRevisionProposals(plan.files), [plan.files])
  const { detected, unclear } = proposals
  if (updates === 0 && detected.length === 0 && unclear.length === 0) return null
  const disabled = pending || !onRevisionChange
  return (
    <DecisionSection
      icon={History}
      title={t('folderUpload.revision.title', { count: updates + detected.length || unclear.length })}
      data-testid="folder-upload-revisions"
    >
      {(detected.length > 0 || unclear.length > 0) && <DecisionNote>{t('folderUpload.revision.consequence')}</DecisionNote>}

      {updates > 0 && (
        <DecisionRow
          data-testid="folder-upload-include-updates"
          muted={!includeUpdates}
          control={
            <Checkbox
              checked={includeUpdates}
              onCheckedChange={(checked) => onIncludeUpdatesChange(checked === true)}
              disabled={pending}
              aria-label={t('folderUpload.revision.sameNameTitle', { count: updates })}
            />
          }
          title={<span className="font-medium">{t('folderUpload.revision.sameNameTitle', { count: updates })}</span>}
          detail={t('folderUpload.revision.sameNameReason')}
        />
      )}

      {detected.length > 0 && (
        <DetectedProposals proposals={proposals} disabled={disabled} destination={destination} onRevisionChange={onRevisionChange} />
      )}

      {unclear.length > 0 && (
        <DecisionSubgroup
          title={t('folderUpload.revision.unclearTitle', { count: unclear.length })}
          data-testid="folder-upload-revisions-unclear"
        >
          <DecisionNote>{t('folderUpload.revision.unclearHint')}</DecisionNote>
          {unclear.map((file, index) => (
            <div key={`${index}:${file.originPath}`} data-testid="folder-upload-revision-unclear-row">
              <DecisionRow
                muted={!file.revisionOf.chosen}
                control={<ProposalBox file={file} disabled={disabled} onRevisionChange={onRevisionChange} />}
                title={<DecisionFileName name={file.file.name} />}
                detail={
                  file.revisionOf.newer
                    ? t('folderUpload.revision.reasonSeveral')
                    : t('folderUpload.revision.reasonNotNewer', { name: file.revisionOf.of.name })
                }
              />
              {file.revisionOf.candidates.length > 1 && (
                <DecisionRowExtra>
                  <CandidatePick file={file} disabled={disabled} onRevisionChange={onRevisionChange} />
                </DecisionRowExtra>
              )}
            </div>
          ))}
        </DecisionSubgroup>
      )}
    </DecisionSection>
  )
}

function DetectedProposals({
  proposals,
  disabled,
  destination,
  onRevisionChange,
}: {
  proposals: RevisionProposals
  disabled: boolean
  destination: string
  onRevisionChange?: (change: RevisionChange) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { detected, master, ticked } = proposals
  const runs = groupByFolder(detected)
  const masterLabel =
    master === 'all'
      ? t('folderUpload.revision.masterAll', { count: detected.length })
      : master === 'some'
        ? t('folderUpload.revision.masterSome', { ticked, count: detected.length })
        : t('folderUpload.revision.masterNone', { count: detected.length })
  return (
    <div data-testid="folder-upload-revisions-detected">
      <DecisionBar>
        <DecisionRow
          control={
            <Checkbox
              checked={master === 'all' ? true : master === 'some' ? 'indeterminate' : false}
              onCheckedChange={() => onRevisionChange?.({ files: detected.map((file) => file.file), chosen: masterTarget(master) })}
              disabled={disabled}
              aria-label={masterLabel}
              data-testid="folder-upload-revision-master"
            />
          }
          title={
            <span className="font-medium tabular-nums" data-testid="folder-upload-revision-master-label">
              {masterLabel}
            </span>
          }
          detail={t('folderUpload.revision.seriesReason')}
        />
      </DecisionBar>
      {runs.map((run) => (
        <div key={run.folder} role="group" aria-label={run.folder || destination}>
          {(runs.length > 1 || run.folder !== '') && (
            <DecisionGroupLabel count={run.files.length}>
              <MiddleTruncate text={run.folder || destination} tail={24} />
            </DecisionGroupLabel>
          )}
          {run.files.map((file, index) => (
            <DecisionRow
              key={`${index}:${file.originPath}`}
              data-testid="folder-upload-revision-row"
              muted={!file.revisionOf.chosen}
              control={<ProposalBox file={file} disabled={disabled} onRevisionChange={onRevisionChange} />}
              title={<DecisionFileName name={file.file.name} />}
              detail={
                <DecisionTarget
                  prefix={t('folderUpload.revision.ofPrefix')}
                  name={file.revisionOf.of.name}
                  label={file.revisionOf.of.label}
                />
              }
            />
          ))}
        </div>
      ))}
    </div>
  )
}
