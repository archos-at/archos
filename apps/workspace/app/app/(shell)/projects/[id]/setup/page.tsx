import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { NotFoundError } from '@/lib/api/errors'
import { findProjectInOrg } from '@/lib/projects/repository'
import { isProjectClosed } from '@/lib/projects/project-status'
import { getIntakeView } from '@/lib/project-intake/service'
import { getTranslations } from '@/i18n/server'
import { navCopy } from '@/i18n/namespaces/nav'
import { IntakeSetup } from '@/features/project-intake/components/intake-setup'
import { isNewProjectDropKey } from '@/features/documents/lib/dropped-file-handover'

interface SetupPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ drop?: string | string[] }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(navCopy)
  return { title: t('tabTitle.setup') }
}

export default async function SetupPage({ params, searchParams }: SetupPageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    const { drop } = await searchParams
    await requireProjectAccess(session, id, 'project:view')

    const project = await findProjectInOrg(id, session.organizationId)
    if (!project) notFound()

    const initial = await getIntakeView(session, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) return null
      throw error
    })

    return (
      <IntakeSetup
        projectId={id}
        projectName={project.name}
        collectionName={project.collectionName}
        initial={initial}
        projectClosed={isProjectClosed(project)}
        dropKey={isNewProjectDropKey(drop) ? drop : null}
      />
    )
  })
}
