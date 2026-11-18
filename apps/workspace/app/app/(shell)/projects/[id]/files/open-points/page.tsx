import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { canWriteFolder } from '@/lib/authz/folder-access'
import { listProjectAnnotations } from '@/lib/annotations/project-marks'
import { PROJECT_MARKS_PAGE_SIZE } from '@/lib/annotations/project-types'
import { findProjectInOrg } from '@/lib/projects/repository'
import { getTranslations } from '@/i18n/server'
import { filesCopy } from '@/i18n/namespaces/files'
import { OpenPointsPanel } from '@/features/documents/components/open-points/open-points-panel'

interface OpenPointsPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(filesCopy)
  return { title: t('openPoints.title') }
}

export default async function OpenPointsPage({ params }: OpenPointsPageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    await requireProjectAccess(session, id, 'project:view')
    const project = await findProjectInOrg(id, session.organizationId)
    if (!project) notFound()
    const mayFile = project.status !== 'closed' && (await canWriteFolder(session, id, null))
    const initial = await listProjectAnnotations(session, id, {
      status: 'open',
      order: 'document',
      limit: PROJECT_MARKS_PAGE_SIZE,
    }).catch((error: unknown) => {
      console.error('[open-points] the open points could not be read:', error)
      return null
    })
    return (
      <OpenPointsPanel
        projectId={id}
        currentUserId={session.userId}
        initial={initial}
        filing={mayFile ? { projectName: project.name } : null}
      />
    )
  })
}
