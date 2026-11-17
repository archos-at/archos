'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'
import { ProjectSectionActions } from '@/components/shell/project-section-frame'
import { createDocumentNameProbeClient } from '@/lib/documents/name-probe-client'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentLifecyclePermission } from '@/lib/documents/lifecycle-types'
import { askAboutFile } from '../lib/ask-about-file'
import type { FileShelf } from '../lib/file-shelf'
import { usePhoneLayout } from '../hooks/use-phone-layout'
import { projectEndpoints } from '../lib/file-shelf'
import type { DocumentWireRow } from '../lib/file-item'
import { useProjectDocuments } from '../hooks/use-project-documents'
import type { FolderItem } from '../file-types'
import { FileWorkspace } from './file-workspace'
import { MailImportAction } from './mail-import-action'
import { MailImportDialog } from './mail-import-dialog'
import { SearchWorkspace, ShelfSearchBack, useShelfSearchMode } from '@/features/search'

export type { FileAssignee, FileItem, FolderItem } from '../file-types'

interface ProjectFileWorkspaceProps {
  projectId: string
  projectName: string
  collectionName: string
  showModels?: boolean
  canCollaborate?: boolean
  currentUserId?: string
  lifecyclePermissions?: readonly DocumentLifecyclePermission[]
  initialFolders?: readonly FolderItem[]
  initialFiles?: readonly DocumentWireRow[]
  initialNextCursor?: string | null
  initialFolderId?: string | null
  canManageFolderAccess?: boolean
  initialRootAccess?: 'read' | 'write'
  mailImportEnabled?: boolean
  inboundMail?: FileShelf['inboundMail']
}

export function ProjectFileWorkspace({
  projectId,
  projectName,
  collectionName,
  showModels = false,
  canCollaborate = false,
  currentUserId,
  lifecyclePermissions,
  initialFolders,
  initialFiles,
  initialNextCursor = null,
  initialFolderId = null,
  canManageFolderAccess = false,
  initialRootAccess = 'write',
  mailImportEnabled = false,
  inboundMail,
}: ProjectFileWorkspaceProps) {
  const t = useTranslations(filesCopy)
  const router = useRouter()
  const probe = useMemo(() => createDocumentNameProbeClient(), [])
  const phone = usePhoneLayout()
  const [mailOpen, setMailOpen] = useState(false)
  const mailOffered = mailImportEnabled && initialRootAccess === 'write'
  const search = useShelfSearchMode()

  const shelf: FileShelf = {
    source: 'project',
    documentScope: 'files',
    endpoints: projectEndpoints(projectId),
    projectId,
    collectionName,
    canManage: true,
    folderAccess: { projectId, canManage: canManageFolderAccess, initialRootAccess },
    bin: { href: `/app/projects/${projectId}/files/bin` },
    openPoints: { href: `/app/projects/${projectId}/files/open-points` },
    inboundMail,
    canCollaborate,
    currentUserId,
    askAbout: (file) => askAboutFile({ projectId, file, navigate: (href) => router.push(href) }),
    useUpload: ({ collectionName: collection, folderId, onComplete }) =>
      useProjectDocuments({ projectId, collectionName: collection, folderId, onComplete }),
    probeNames: (names) => probe.project(projectId, names),
    probeRevisions: (names, landsIn) => probe.projectRevisions(projectId, names, landsIn),
    handoverKey: projectId,
    preview: { kind: 'store', projectName },
    messages: {
      dropToUpload: t('workspace.dropToUpload'),
      ingestionComplete: (name) => t('toast.ingestionComplete', { name }),
    },
    showModels,
    lifecyclePermissions,
  }

  if (search.active) {
    return (
      <>
        <ProjectSectionActions>
          <ShelfSearchBack onClose={search.close} label="backToFiles" />
        </ProjectSectionActions>
        <SearchWorkspace surface={{ kind: 'project', projectId, folderId: search.folderId }} currentUserId={currentUserId} inset autoFocus />
      </>
    )
  }

  return (
    <>
      <FileWorkspace
        shelf={shelf}
        renderHeader={(controls) => (
          <ProjectSectionActions>
            {controls}
            {mailOffered && !phone && <MailImportAction projectId={projectId} />}
          </ProjectSectionActions>
        )}
        onOpenSearch={search.open}
        moreEntries={[
          ...(mailOffered && phone
            ? [
                {
                  type: 'item' as const,
                  id: 'mail-import',
                  label: t('mailImport.action'),
                  icon: Mail,
                  onSelect: () => setMailOpen(true),
                  testId: 'mail-import-trigger',
                },
              ]
            : []),
        ]}
        initialFolders={initialFolders}
        initialFiles={initialFiles}
        initialNextCursor={initialNextCursor}
        initialFolderId={initialFolderId}
      />
      {mailOffered && phone && <MailImportDialog projectId={projectId} open={mailOpen} onOpenChange={setMailOpen} />}
    </>
  )
}
