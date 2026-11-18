import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveProjectSettingsAccess } from '@/lib/projects/settings-access'
import { MembersSettings } from '@/features/projects/components/settings/members-settings'
import { getTranslations } from '@/i18n/server'
import { settingsCopy } from '@/i18n/namespaces/settings'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(settingsCopy)
  return { title: t('project.nav.members') }
}

export default async function ProjectMembersSettingsPage({
  params,
}: PageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    await requireProjectAccess(session, id, 'project:view')

    const access = await resolveProjectSettingsAccess(session, id)
    if (!access.manageMembers) notFound()

    return (
      <MembersSettings
        projectId={id}
        currentMembershipId={session.organizationMembershipId}
      />
    )
  })
}
