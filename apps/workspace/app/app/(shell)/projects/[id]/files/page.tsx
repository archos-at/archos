import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { can } from '@/lib/authz/decide'
import {
  isCollaborationEnabled,
  isInboundMailEnabled,
  isMailImportEnabled,
  isIfcModelsEnabled,
} from '@/lib/authz/feature-flags'
import { requireMailReviewer } from '@/lib/inbound-mail/access'
import { findProjectInOrg } from '@/lib/projects/repository'
import { listProjectFolders, projectRootAccess } from '@/lib/projects/folder-service'
import { listDocumentsPage } from '@/lib/documents/document-listing'
import { DOCUMENT_LEVEL_PAGE_SIZE } from '@/lib/documents/list-query'
import { summarizeDocumentVersions } from '@/lib/documents/lifecycle'
import { resolveDocumentLifecyclePermissions } from '@/lib/documents/lifecycle-permissions'
import { toDocumentWireRow, toFolderWireRow } from '@/lib/documents/list-projection'
import { getTranslations } from '@/i18n/server'
import { navCopy } from '@/i18n/namespaces/nav'
import { ProjectFilesClient } from './project-files-client'

interface FilesPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const FOLDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(navCopy)
  return { title: t('sections.files') }
}

export default async function FilesPage({ params, searchParams }: FilesPageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    const { folder } = await searchParams
    const folderParam = typeof folder === 'string' ? folder.trim() : ''
    const seedLevel = folderParam === '' || FOLDER_ID.test(folderParam)
    const initialFolderId = folderParam === '' || !seedLevel ? null : folderParam
    await requireProjectAccess(session, id, 'project:view')

    const project = await findProjectInOrg(id, session.organizationId)

    if (!project) {
      notFound()
    }

    const showModels = isIfcModelsEnabled(session)

    const [initialFolders, { documents: initialDocuments, nextCursor }] = await Promise.all([
      listProjectFolders(id, session),
      seedLevel
        ? listDocumentsPage(session, id, {
            level: { folderId: initialFolderId, sort: 'added', dir: 'desc', limit: DOCUMENT_LEVEL_PAGE_SIZE },
          })
        : Promise.resolve<Awaited<ReturnType<typeof listDocumentsPage>>>({ documents: [], nextCursor: null }),
    ])

    const inboundMailEnabled =
      isInboundMailEnabled(session) && (await requireMailReviewer(session, id).then(() => true, () => false))
    const [versionSummaries, lifecyclePermissions, canManageFolderAccess, initialRootAccess] = await Promise.all([
      summarizeDocumentVersions(
        session.organizationId,
        initialDocuments.map((row) => row.id),
      ),
      resolveDocumentLifecyclePermissions(session, id),
      can(session, 'project:manage', { type: 'project', id }),
      projectRootAccess(session, id),
    ])

    return (
      <ProjectFilesClient
        lifecyclePermissions={lifecyclePermissions}
        projectId={id}
        initialFolders={initialFolders.map(toFolderWireRow)}
        canManageFolderAccess={canManageFolderAccess}
        initialRootAccess={initialRootAccess}
        initialFiles={
          seedLevel
            ? initialDocuments.map((row) => toDocumentWireRow(row, versionSummaries.get(row.id)))
            : undefined
        }
        initialNextCursor={nextCursor}
        initialFolderId={initialFolderId}
        projectName={project.name}
        collectionName={project.collectionName}
        showModels={showModels}
        canCollaborate={isCollaborationEnabled(session)}
        currentUserId={session.userId}
        mailImportEnabled={isMailImportEnabled(session)}
        inboundMailEnabled={inboundMailEnabled}
      />
    )
  })
}
