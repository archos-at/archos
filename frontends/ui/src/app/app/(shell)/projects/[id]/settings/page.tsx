import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getProjectOverviewData } from '@/lib/projects/overview-query'
import { resolveProjectSettingsAccess } from '@/lib/projects/settings-access'
import { GeneralSettings } from '@/features/projects/components/settings/general-settings'
import { getTranslations } from '@/i18n/server'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('sections.settings') }
}

/** Settings → General: the project's name, its size, and its deletion. */
export default async function ProjectGeneralSettingsPage({
  params,
}: PageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    await requireProjectAccess(session, id, 'project:view')

    const [data, access] = await Promise.all([
      getProjectOverviewData(id, session.organizationId),
      resolveProjectSettingsAccess(session, id),
    ])
    if (!data) notFound()

    return (
      <GeneralSettings
        projectId={data.id}
        projectName={data.name}
        createdAt={data.createdAt}
        documentCount={data.documentCount}
        totalFileSize={data.totalFileSize}
        canManage={access.manage}
      />
    )
  })
}
