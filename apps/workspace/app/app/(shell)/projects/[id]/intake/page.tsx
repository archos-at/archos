import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { FEATURE_FLAGS, isFeatureEnabled } from '@/lib/authz/feature-flags'
import { findProjectInOrg } from '@/lib/projects/repository'
import { deriveIntakeEntry } from '@/lib/project-profile/salvage'
import { getTranslations } from '@/i18n/server'
import { navCopy } from '@/i18n/namespaces/nav'
import { ProjectIntakeWizard } from '@/features/projects/components/project-intake-wizard'

interface IntakePageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(navCopy)
  return { title: t('tabTitle.intake') }
}

export default async function IntakePage({ params }: IntakePageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params

    await requireProjectAccess(session, id, 'project:view')

    const project = await findProjectInOrg(id, session.organizationId)

    if (!project) {
      notFound()
    }

    const { mode, initialProfile, salvageNotice } = deriveIntakeEntry(project.profile)

    const conflictCheckEnabled = isFeatureEnabled(session, FEATURE_FLAGS.wizardConflictCheck)

    return (
      <ProjectIntakeWizard
        projectId={id}
        projectName={project.name}
        mode={mode}
        initialProfile={initialProfile}
        initialProfileVersion={project.profileVersion}
        conflictCheckEnabled={conflictCheckEnabled}
        salvageNotice={salvageNotice}
      />
    )
  })
}
