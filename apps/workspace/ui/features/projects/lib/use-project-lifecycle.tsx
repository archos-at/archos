'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ApiRequestError } from '@/adapters/api/api-error'
import {
  setProjectStatus,
  type ClosingChoice,
  type ProjectStatusChange,
} from '@/adapters/api/project-lifecycle-client'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { projectsCopy } from '@/i18n/namespaces/projects'
import type { ProjectProfile } from '@/lib/project-profile/types'
import type { ProjectLifecycleView } from '@/lib/projects/project-status'
import { CloseProjectDialog } from '../components/close-project-dialog'
import { ClosingDebrief } from '../components/closing-debrief'
import { ClosingProjectRecord } from '../components/closing-project-record'

export interface UseProjectLifecycleOptions {
  projectId: string
  lifecycle: ProjectLifecycleView
  profile?: ProjectProfile | null
  canWriteMemory?: boolean
}

export interface ProjectLifecycleControls {
  pause: () => Promise<void>
  resume: () => Promise<void>
  requestClose: () => void
  requestReopen: () => void
  pending: boolean
  dialogs: ReactNode
}

export type { ClosingChoice }

export function useProjectLifecycle({
  projectId,
  lifecycle,
  profile = null,
  canWriteMemory = false,
}: UseProjectLifecycleOptions): ProjectLifecycleControls {
  const t = useTranslations(projectsCopy)
  const tCommon = useTranslations(commonCopy)
  const router = useRouter()
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [pending, setPending] = useState(false)

  const move = async (body: ProjectStatusChange, done: string): Promise<boolean> => {
    setPending(true)
    try {
      await setProjectStatus(projectId, body)
      toast.success(done, body.status === 'paused' ? { action: { label: t('lifecycle.toast.undo'), onClick: () => void resume() } } : undefined)
      router.refresh()
      return true
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        toast.error(t('lifecycle.toast.conflict'))
        router.refresh()
        return false
      }
      toast.error(t('lifecycle.toast.error'))
      return false
    } finally {
      setPending(false)
    }
  }

  const resume = async (): Promise<void> => {
    await move({ status: 'active' }, t('lifecycle.toast.resumed'))
  }

  const close = async (choice: ClosingChoice): Promise<boolean> => {
    const ok = await move({ status: 'closed', ...choice }, t('lifecycle.toast.closed'))
    if (ok) setClosing(false)
    return ok
  }

  const dialogs = (
    <>
      {/* Mounted only while asked for: a surface that never opens a dialog
          (the banner never closes a project) holds none. */}
      {closing && lifecycle.status !== 'closed' && (
        <CloseProjectDialog projectId={projectId} lifecycle={lifecycle} open onOpenChange={setClosing} onClose={close}>
          <div className="space-y-5">
            <ClosingDebrief projectId={projectId} profile={profile} canWriteMemory={canWriteMemory} />
            <ClosingProjectRecord projectId={projectId} />
          </div>
        </CloseProjectDialog>
      )}
      {reopening && lifecycle.status === 'closed' && (
        <ConfirmDialog
          open
          onOpenChange={setReopening}
          tone="default"
          title={t('lifecycle.reopenDialog.title')}
          description={t('lifecycle.reopenDialog.description')}
          confirmLabel={t('lifecycle.reopenDialog.confirm')}
          cancelLabel={tCommon('actions.cancel')}
          onConfirm={async () => {
            if (await move({ status: 'active' }, t('lifecycle.toast.reopened'))) setReopening(false)
          }}
          pending={pending}
        />
      )}
    </>
  )

  return {
    pause: async () => {
      await move({ status: 'paused' }, t('lifecycle.toast.paused'))
    },
    resume,
    requestClose: () => setClosing(true),
    requestReopen: () => setReopening(true),
    pending,
    dialogs,
  }
}
