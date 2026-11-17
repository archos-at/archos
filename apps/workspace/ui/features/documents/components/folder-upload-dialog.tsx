'use client'

import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Copy,
  FilePlus2,
  FolderInput,
  FolderPlus,
  History,
  MoveRight,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CountPill } from '@/components/ui/count-pill'
import { MiddleTruncate } from '@/components/ui/middle-truncate'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { StatCardIcon, type StatCardIconTone } from '@/components/ui/stat-card'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import {
  countNewRevisions,
  groupByFolder,
  groupRevisionProposals,
  masterTarget,
  soleProposal,
  type RevisionChange,
  type RevisionProposals,
  type ProposedFile,
} from '../lib/revision-proposals'
import {
  countPlan,
  type RevisionTarget,
  type FolderUploadCounts,
  type FolderUploadPlan,
  type PlannedAction,
  type PlannedFile,
} from '../lib/folder-upload-plan'
import type { UploadDecisionKind } from '../hooks/use-upload-decision'
import { describeNameMatch } from '@/lib/upload-screening/quarantine'
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
} from './upload-decision-atoms'

export interface FolderUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: FolderUploadPlan | null
  currentFolderName: string | null
  onConfirm: (includeUpdates: boolean) => void | Promise<void>
  pending?: boolean
  kind?: UploadDecisionKind
  onReleaseChange?: (file: File, released: boolean) => void
  onRevisionChange?: (change: RevisionChange) => void
}

export function FolderUploadDialog({
  open,
  onOpenChange,
  plan,
  currentFolderName,
  onConfirm,
  pending = false,
  kind = 'folder',
  onReleaseChange,
  onRevisionChange,
}: FolderUploadDialogProps): JSX.Element {
  const t = useTranslations(filesCopy)
  const contentRef = useRef<HTMLDivElement>(null)
  const [includeUpdates, setIncludeUpdates] = useState(true)
  const [soleAnswer, setSoleAnswer] = useState<boolean | null>(null)

  useEffect(() => {
    if (plan) return
    setIncludeUpdates(true)
    setSoleAnswer(null)
  }, [plan])

  const counts = useMemo(
    () => (plan ? countPlan(plan.files, plan.folders, includeUpdates) : null),
    [plan, includeUpdates],
  )

  const destination = currentFolderName ?? t('folders.allFiles')
  const isFolder = kind === 'folder'
  const single =
    !isFolder && plan?.files.length === 1 && (plan.files[0].action === 'update' || plan.files[0].action === 'unchanged')
      ? plan.files[0]
      : null
  const sole = !isFolder && plan ? soleProposal(plan.files) : null

  useEffect(() => {
    if (soleAnswer === null || !sole || sole.revisionOf.chosen !== soleAnswer) return
    setSoleAnswer(null)
    void onConfirm(true)
  }, [soleAnswer, sole, onConfirm])

  const answerSole = (asRevision: boolean) => {
    if (!sole) return
    if (sole.revisionOf.chosen !== asRevision) onRevisionChange?.({ files: [sole.file], chosen: asRevision })
    setSoleAnswer(asRevision)
  }

  const { title, description, HeaderIcon } = describeHeader({ t, plan, single, sole, isFolder, destination })
  const nothingToDo = !counts || counts.uploading + counts.moving === 0
  const batch = Boolean(plan && counts && !single && !sole)
  const revisions = plan ? countNewRevisions(plan.files, includeUpdates) : 0

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent
        ref={contentRef}
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0 outline-none! max-sm:px-0',
          batch || sole ? 'sm:max-w-xl' : 'sm:max-w-lg',
        )}
        fullScreenOnMobile={batch}
        closeLabel={t('folderUpload.close')}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus()
        }}
        aria-busy={pending || undefined}
        data-testid="folder-upload-dialog"
        data-kind={sole ? 'single-revision' : single ? `single-${single.action}` : kind}
      >
        <DialogHeader className="px-4 pt-6 pb-4 pr-12 text-left sm:px-6 sm:pr-12">
          <div className="flex items-start gap-3.5">
            <StatCardIcon icon={HeaderIcon} tone={single?.action === 'unchanged' ? 'muted' : 'info'} />
            <div className="min-w-0 space-y-1.5">
              <DialogTitle className="leading-snug">{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          {!plan || !counts ? (
            <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground" data-testid="folder-upload-planning">
              <Spinner size="sm" />
              {t('folderUpload.planning')}
            </div>
          ) : sole ? (
            <SoleCandidatePick file={sole} disabled={pending || soleAnswer !== null} onRevisionChange={onRevisionChange} />
          ) : single ? (
            <SingleNotes single={single} destination={destination} />
          ) : (
            <BatchPlan
              plan={plan}
              counts={counts}
              isFolder={isFolder}
              includeUpdates={includeUpdates}
              onIncludeUpdatesChange={setIncludeUpdates}
              pending={pending}
              destination={destination}
              onReleaseChange={onReleaseChange}
              onRevisionChange={onRevisionChange}
            />
          )}
        </DialogBody>

        <DialogFooter className={cn('px-4 pb-6 pt-4 sm:flex-wrap sm:px-6', batch && 'border-t')}>
          {sole ? (
            <SoleFooter
              file={sole}
              busy={pending || soleAnswer !== null}
              canChange={Boolean(onRevisionChange)}
              onAnswer={answerSole}
            />
          ) : single && nothingToDo ? (
            <Button onClick={() => onOpenChange(false)} data-testid="folder-upload-close">
              {t('folderUpload.close')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
                {t('folderUpload.cancel')}
              </Button>
              <Button
                onClick={() => void onConfirm(single ? true : includeUpdates)}
                disabled={pending || nothingToDo}
                data-testid="folder-upload-confirm"
              >
                {pending && <Spinner size="sm" />}
                {confirmLabel({ t, counts, single, nothingToDo, revisions })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Translate = ReturnType<typeof useTranslations>

function describeHeader({
  t,
  plan,
  single,
  sole,
  isFolder,
  destination,
}: {
  t: Translate
  plan: FolderUploadPlan | null
  single: PlannedFile | null
  sole: ProposedFile | null
  isFolder: boolean
  destination: string
}): { title: string; description: string; HeaderIcon: LucideIcon } {
  if (sole) return { ...describeSole(t, sole), HeaderIcon: History }
  if (single) {
    const shownAs = single.existingName ?? single.file.name
    return single.action === 'update'
      ? {
          title: t('folderUpload.single.newRevisionTitle', { name: single.file.name }),
          description: t('folderUpload.single.updateExplain', { name: shownAs }),
          HeaderIcon: History,
        }
      : {
          title: t('folderUpload.single.unchangedTitle'),
          description: t('folderUpload.single.unchangedExplain', { name: shownAs }),
          HeaderIcon: ShieldCheck,
        }
  }
  if (isFolder) {
    return {
      title: plan?.rootName ? t('folderUpload.title', { name: plan.rootName }) : t('folderUpload.titleGeneric'),
      description: plan?.mergedIntoCurrentFolder
        ? t('folderUpload.destinationMerged', { folder: destination })
        : t('folderUpload.destination', { folder: destination }),
      HeaderIcon: FolderInput,
    }
  }
  return {
    title: plan ? t('folderUpload.titleFiles', { count: plan.files.length }) : t('folderUpload.titleFilesGeneric'),
    description: t('folderUpload.destinationFiles', { folder: destination }),
    HeaderIcon: FilePlus2,
  }
}

function describeSole(t: Translate, sole: ProposedFile): { title: string; description: string } {
  const { of, candidates, newer } = sole.revisionOf
  const file = sole.file.name
  if (candidates.length > 1) {
    return { title: t('folderUpload.single.unclearTitle', { file }), description: t('folderUpload.single.unclearExplain') }
  }
  if (!newer) {
    return {
      title: t('folderUpload.single.unclearTitle', { file }),
      description: t('folderUpload.single.notNewerExplain', { file, name: of.name }),
    }
  }
  return {
    title: t('folderUpload.single.newRevisionTitle', { name: of.name }),
    description: t('folderUpload.single.revisionExplain', { file, name: of.name }),
  }
}

function confirmLabel({
  t,
  counts,
  single,
  nothingToDo,
  revisions,
}: {
  t: Translate
  counts: FolderUploadCounts | null
  single: PlannedFile | null
  nothingToDo: boolean
  revisions: number
}): string {
  if (nothingToDo || !counts) return t('folderUpload.nothingToDo')
  if (single?.action === 'update') return t('folderUpload.single.confirmRevision')
  if (counts.uploading === 0) return t('folderUpload.confirmMoveOnly', { count: counts.moving })
  return revisions > 0
    ? t('folderUpload.confirmWithRevisions', { count: counts.uploading, revisions })
    : t('folderUpload.confirm', { count: counts.uploading })
}

function DialogBody({ children }: { children: JSX.Element }): JSX.Element {
  return <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">{children}</div>
}

function SingleNotes({ single, destination }: { single: PlannedFile; destination: string }): JSX.Element | null {
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

function SoleCandidatePick({
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

function SoleFooter({
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

function BatchPlan({
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

function RevisionSection({
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

function ProposalBox({
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

function CandidatePick({
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

function ScreeningSection({
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

function PlanDetails({
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

type EffectiveAction = Exclude<PlannedAction, 'update'> | 'revision' | 'skipped'

function effectiveAction(file: PlannedFile, includeUpdates: boolean): EffectiveAction {
  if (file.action === 'update') return includeUpdates ? 'revision' : 'skipped'
  if (file.action === 'new' && file.revisionOf?.chosen) return 'revision'
  return file.action
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
