'use client'

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { BookOpenCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UploadHistory } from '@/features/uploads/components/upload-history'
import { useTranslations } from '@/i18n'
import { settingsCopy } from '@/i18n/namespaces/settings'
import { uploadBatchesCopy } from '@/i18n/namespaces/upload-batches'
import { ProjectReindexCard } from '../project-reindex-card'
import { SettingsPanel } from '@/components/settings/settings-panel'

export interface DocumentsSettingsProps {
  projectId: string
  currentUserId: string | null
  canReindex: boolean
  showKnowledgeLink: boolean
  inboundMailAddress?: ReactNode
}

export function DocumentsSettings({
  projectId,
  currentUserId,
  canReindex,
  showKnowledgeLink,
  inboundMailAddress,
}: DocumentsSettingsProps): JSX.Element {
  const t = useTranslations(settingsCopy)
  const tUploads = useTranslations(uploadBatchesCopy)

  return (
    <div className="flex flex-col gap-6">
      <SettingsPanel
        title={t('project.documents.uploadsTitle')}
        description={tUploads('history.description')}
      >
        <UploadHistory projectId={projectId} currentUserId={currentUserId} />
      </SettingsPanel>

      {inboundMailAddress}

      {canReindex && <ProjectReindexCard projectId={projectId} />}

      {showKnowledgeLink && (
        <SettingsPanel
          title={t('project.documents.knowledgeTitle')}
          description={t('project.documents.knowledgeDescription')}
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/app/projects/${encodeURIComponent(projectId)}/knowledge`}>
                <BookOpenCheck className="size-4" aria-hidden />
                {t('project.documents.knowledgeLink')}
              </Link>
            </Button>
          }
        />
      )}
    </div>
  )
}
