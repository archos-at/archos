'use client'


import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { StatCardIcon } from '@/components/ui/stat-card'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { countNewRevisions, soleProposal, type RevisionChange } from '../lib/revision-proposals'
import { countPlan, type FolderUploadPlan } from '../lib/folder-upload-plan'
import type { UploadDecisionKind } from '../hooks/use-upload-decision'
import { confirmLabel, describeHeader } from '../lib/folder-upload-labels'
import { BatchPlan } from './folder-upload-dialog/batch-plan'
import { SingleNotes } from './folder-upload-dialog/single-notes'
import { SoleCandidatePick, SoleFooter } from './folder-upload-dialog/sole-revision'

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

function DialogBody({ children }: { children: JSX.Element }): JSX.Element {
  return <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">{children}</div>
}
