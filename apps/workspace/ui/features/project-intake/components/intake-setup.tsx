'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FolderUploadDialog } from '@/features/documents/components/folder-upload-dialog'
import { UploadTray } from '@/features/documents/components/upload-tray'
import { useFilingSuggestions } from '@/features/documents/hooks/use-filing-suggestions'
import { useTranslations } from '@/i18n'
import { projectIntakeCopy } from '@/i18n/namespaces/project-intake'
import type { ProjectIntakeClient } from '@/lib/project-intake/client'
import type { IntakeView } from '@/lib/project-intake/types'
import { useIntake } from '../hooks/use-intake'
import { useIntakeUpload } from '../hooks/use-intake-upload'
import { IntakeSetupView } from './intake-setup-view'

export interface IntakeSetupProps {
  projectId: string
  projectName?: string
  collectionName: string
  initial: IntakeView | null
  projectClosed: boolean
  dropKey?: string | null
  client?: ProjectIntakeClient
}

export function IntakeSetup({ initial, ...rest }: IntakeSetupProps): JSX.Element {
  if (initial === null) return <NoIntake projectId={rest.projectId} />
  return <ConnectedSetup initial={initial} {...rest} />
}

function NoIntake({ projectId }: { projectId: string }): JSX.Element {
  const t = useTranslations(projectIntakeCopy)
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8" data-testid="intake-none">
      <EmptyState
        icon={ClipboardList}
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <Button asChild variant="secondary">
            <Link href={`/app/projects/${projectId}/intake`}>{t('empty.action')}</Link>
          </Button>
        }
      />
    </div>
  )
}

function ConnectedSetup({
  projectId,
  projectName,
  collectionName,
  initial,
  projectClosed,
  dropKey = null,
  client,
}: Omit<IntakeSetupProps, 'initial'> & { initial: IntakeView }): JSX.Element {
  const intake = useIntake({ projectId, initial, client })
  const { view, watch, refresh } = intake
  const { send, shelfUpload, upload } = useIntakeUpload({
    projectId,
    collectionName,
    dropKey: projectClosed ? null : dropKey,
    onSettled: () => {
      watch()
      void refresh()
    },
  })
  const filingQuery = useMemo(() => ({ projectId }), [projectId])
  const filing = useFilingSuggestions({
    query: filingQuery,
    refreshKey: view.counts.documentsRead + view.counts.unreadDocuments,
    watching: upload.isUploading || view.status === 'reading',
  })
  const files = useMemo(
    () => upload.trackedFiles.filter((file) => file.collectionName === collectionName),
    [upload.trackedFiles, collectionName]
  )

  return (
    <IntakeSetupView
      view={view}
      projectId={projectId}
      projectName={projectName}
      busy={intake.busy}
      stale={intake.stale}
      canUpload={!projectClosed}
      uploading={upload.isUploading}
      onFiles={send}
      onDecide={intake.decide}
      onReread={() => void intake.reread()}
      onComplete={intake.complete}
      onRetry={() => void intake.refresh()}
      filing={{ entries: filing.byFolder, onSettled: filing.reload }}
    >
      {files.length > 0 && (
        <UploadTray
          files={files}
          onRetry={(id) => void upload.retryFile(id)}
          onCancel={upload.cancelFile}
          onCancelAll={upload.cancelUpload}
          onDismiss={upload.dismissFiles}
        />
      )}
      <FolderUploadDialog
        open={shelfUpload.decision.open}
        onOpenChange={shelfUpload.decision.setOpen}
        plan={shelfUpload.decision.plan}
        currentFolderName={null}
        onConfirm={shelfUpload.applyFolderPlan}
        pending={shelfUpload.decision.pending}
        kind={shelfUpload.decision.kind}
        onReleaseChange={shelfUpload.onReleaseChange}
        onRevisionChange={shelfUpload.onRevisionChange}
      />
    </IntakeSetupView>
  )
}
