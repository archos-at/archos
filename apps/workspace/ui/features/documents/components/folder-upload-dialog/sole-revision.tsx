import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { ProposedFile, RevisionChange } from '../../lib/revision-proposals'
import { CandidatePick } from './revision-controls'

export function SoleCandidatePick({
  file,
  disabled,
  onRevisionChange,
}: {
  file: ProposedFile
  disabled: boolean
  onRevisionChange?: (change: RevisionChange) => void
}): JSX.Element | null {
  if (file.revisionOf.candidates.length < 2) return null
  return (
    <div className="pb-1">
      <CandidatePick file={file} disabled={disabled || !onRevisionChange} onRevisionChange={onRevisionChange} />
    </div>
  )
}

export function SoleFooter({
  file,
  busy,
  canChange,
  onAnswer,
}: {
  file: ProposedFile
  busy: boolean
  canChange: boolean
  onAnswer: (asRevision: boolean) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { chosen, newer, candidates } = file.revisionOf
  const needsPick = candidates.length > 1 && !chosen
  const revisionBlocked = needsPick || (!canChange && !chosen)
  const separateBlocked = !canChange && chosen
  const leadWithRevision = newer
  return (
    <>
      <Button
        variant={leadWithRevision ? 'secondary' : 'default'}
        onClick={() => onAnswer(false)}
        disabled={busy || separateBlocked}
        data-testid="folder-upload-sole-separate"
      >
        {t('folderUpload.single.confirmSeparate')}
      </Button>
      <Button
        variant={leadWithRevision ? 'default' : 'secondary'}
        onClick={() => onAnswer(true)}
        disabled={busy || revisionBlocked}
        data-testid="folder-upload-sole-revision"
      >
        {t('folderUpload.single.confirmRevision')}
      </Button>
    </>
  )
}
