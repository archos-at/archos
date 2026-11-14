'use client'

/**
 * Settings → Documents & index: who brought which files into the project, the
 * project's mail address (ADR-0137), and whether the index answers are grounded
 * on is current.
 *
 * The upload history is the reference record (ADR-0086); the index controls
 * act on what those uploads became. Both used to sit between the roster and
 * the memory on one long page.
 */

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
  /** Links the reader's own uploads to their summaries (the summary is its uploader's only). */
  currentUserId: string | null
  /** Rebuild the index (`project:documents:write`). */
  canReindex: boolean
  /** The flagged knowledge-base page, linked from here rather than the rail. */
  showKnowledgeLink: boolean
  /**
   * The project mail address card, for a reader who may decide the project's
   * held mail (`inbound-mail` and `project:documents:write`); a manager may
   * create, replace and switch it off there (`InboundMailAddressCard`). Absent:
   * no card. The route passes it in, so the projects feature never imports the
   * inbound-mail feature (module-seams.md).
   */
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
