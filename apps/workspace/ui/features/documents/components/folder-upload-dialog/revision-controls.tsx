import type { JSX } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { RevisionTarget } from '../../lib/folder-upload-plan'
import type { ProposedFile, RevisionChange } from '../../lib/revision-proposals'

export function ProposalBox({
  file,
  disabled,
  onRevisionChange,
}: {
  file: ProposedFile
  disabled: boolean
  onRevisionChange?: (change: RevisionChange) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <Checkbox
      checked={file.revisionOf.chosen}
      onCheckedChange={(checked) => onRevisionChange?.({ files: [file.file], chosen: checked === true })}
      disabled={disabled}
      aria-label={t('folderUpload.revision.offer', { name: file.revisionOf.of.name })}
      data-testid="folder-upload-revision-choice"
    />
  )
}

export function CandidatePick({
  file,
  disabled,
  onRevisionChange,
}: {
  file: ProposedFile
  disabled: boolean
  onRevisionChange?: (change: RevisionChange) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { candidates, of, chosen } = file.revisionOf
  const describe = (candidate: RevisionTarget) => (candidate.label ? `${candidate.name} · ${candidate.label}` : candidate.name)
  return (
    <Select
      value={chosen ? of.id : ''}
      onValueChange={(targetId) => onRevisionChange?.({ files: [file.file], targetId })}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-full min-w-0" aria-label={t('folderUpload.revision.pick')} data-testid="folder-upload-revision-pick">
        <SelectValue placeholder={t('folderUpload.revision.pick')} />
      </SelectTrigger>
      <SelectContent>
        {candidates.map((candidate) => (
          <SelectItem key={candidate.id} value={candidate.id}>
            {describe(candidate)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
