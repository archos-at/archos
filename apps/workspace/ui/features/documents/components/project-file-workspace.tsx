'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProjectSectionActions } from '@/components/shell/project-section-frame'
import { createDocumentNameProbeClient } from '@/lib/documents/name-probe-client'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { DocumentLifecyclePermission } from '@/lib/documents/lifecycle-types'
import { askAboutFile } from '../lib/ask-about-file'
import type { FileShelf } from '../lib/file-shelf'
import { projectEndpoints } from '../lib/file-shelf'
import type { DocumentWireRow } from '../lib/file-item'
import { useProjectDocuments } from '../hooks/use-project-documents'
import type { FolderItem } from '../file-types'
import type { StoredUpload } from '../hooks/use-office-shelf-documents'
import { FileWorkspace } from './file-workspace'
import { useMailImports } from '../hooks/use-mail-imports'
import { MailImportDialogView, type HandedArchives } from './mail-import-dialog'
import { MailImportLine, mailImportOngoing } from './mail-import-line'
import { ProjectNormNotices } from './project-norm-notices'
import { FolderBinDialog } from './folder-bin-dialog'
import { binHrefOf } from '../lib/bin-href'
import { useBinParam } from '../hooks/use-bin-param'
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
  officeStandards?: boolean
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
  officeStandards = false,
}: ProjectFileWorkspaceProps) {
  const t = useTranslations(filesCopy)
  const router = useRouter()
  const probe = useMemo(() => createDocumentNameProbeClient(), [])
  const [mailOpen, setMailOpen] = useState(false)
  const mailOffered = mailImportEnabled && initialRootAccess === 'write'
  const mailImports = useMailImports(projectId, mailOffered)
  const [handedArchives, setHandedArchives] = useState<HandedArchives | null>(null)
  const takeMailArchives = useCallback((files: File[]) => {
    setHandedArchives({ files, onTaken: () => setHandedArchives(null) })
    setMailOpen(true)
  }, [])
  const search = useShelfSearchMode()
  const bin = useBinParam()
  const [awaitingNorms, setAwaitingNorms] = useState<ReadonlySet<string>>(() => new Set())
  const onStored = useCallback(
    (uploads: StoredUpload[]) => setAwaitingNorms((current) => new Set([...current, ...uploads.map((upload) => upload.documentId)])),
    []
  )
  const onAwaited = useCallback(
    (documentIds: readonly string[]) =>
      setAwaitingNorms((current) => new Set([...current].filter((documentId) => !documentIds.includes(documentId)))),
    []
  )

  const shelf: FileShelf = {
    source: 'project',
    documentScope: 'files',
    endpoints: projectEndpoints(projectId),
    projectId,
    collectionName,
    canManage: true,
    folderAccess: { projectId, canManage: canManageFolderAccess, initialRootAccess },
    bin: { href: binHrefOf(`/app/projects/${projectId}/files`) },
    openPoints: { href: `/app/projects/${projectId}/files/open-points` },
    inboundMail,
    canCollaborate,
    currentUserId,
    askAbout: (file) => askAboutFile({ projectId, file, navigate: (href) => router.push(href) }),
    takeMailArchives: mailOffered ? takeMailArchives : undefined,
    openMailImport: mailOffered ? () => setMailOpen(true) : undefined,
    useUpload: ({ collectionName: collection, folderId, onComplete }) =>
      useProjectDocuments({ projectId, collectionName: collection, folderId, onComplete, onStored: officeStandards ? onStored : undefined }),
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
          <ProjectSectionActions>{controls}</ProjectSectionActions>
        )}
        initialFolders={initialFolders}
        initialFiles={initialFiles}
        initialNextCursor={initialNextCursor}
        initialFolderId={initialFolderId}
        renderLevelNotice={({ folderId, revision }) => {
          const importing = mailOffered && mailImportOngoing(mailImports)
          if (!importing && !officeStandards) return null
          return (
            <>
              {importing && <MailImportLine state={mailImports} onOpen={() => setMailOpen(true)} />}
              {officeStandards && (
                <ProjectNormNotices
                  projectId={projectId}
                  folderId={folderId}
                  revision={revision}
                  awaiting={awaitingNorms}
                  onAwaited={onAwaited}
                />
              )}
            </>
          )
        }}
      />
      <FolderBinDialog projectId={projectId} open={bin.open} onOpenChange={bin.setOpen} />
      {mailOffered && (
        <MailImportDialogView
          projectId={projectId}
          open={mailOpen}
          onOpenChange={setMailOpen}
          state={mailImports}
          handed={handedArchives}
        />
      )}
    </>
  )
}
