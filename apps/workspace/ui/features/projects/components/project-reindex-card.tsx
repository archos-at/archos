'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { reindexProject } from '@/adapters/api/project-lifecycle-client'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { settingsCopy } from '@/i18n/namespaces/settings'
import { SettingsPanel } from '@/components/settings/settings-panel'

interface ProjectReindexCardProps {
  projectId: string
}

export function ProjectReindexCard({ projectId }: ProjectReindexCardProps): JSX.Element {
  const t = useTranslations(settingsCopy)
  const tCommon = useTranslations(commonCopy)
  const [confirming, setConfirming] = useState(false)
  const [isReindexing, setIsReindexing] = useState(false)

  const handleReindex = async (): Promise<void> => {
    setIsReindexing(true)
    try {
      await reindexProject(projectId)
      toast.success(t('project.documents.reindexStarted'))
    } catch {
      toast.error(t('project.documents.reindexFailed'))
    } finally {
      setIsReindexing(false)
      setConfirming(false)
    }
  }

  return (
    <>
      <SettingsPanel
        title={t('project.documents.indexTitle')}
        description={t('project.documents.indexDescription')}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={isReindexing}
          >
            <RefreshCw
              className={isReindexing ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
              aria-hidden="true"
            />
            {isReindexing
              ? t('project.documents.reindexBusy')
              : t('project.documents.reindexAction')}
          </Button>
        }
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="warning"
        title={t('project.documents.reindexConfirmTitle')}
        description={t('project.documents.indexDescription')}
        confirmLabel={t('project.documents.reindexAction')}
        cancelLabel={tCommon('actions.cancel')}
        onConfirm={handleReindex}
        pending={isReindexing}
      />
    </>
  )
}
