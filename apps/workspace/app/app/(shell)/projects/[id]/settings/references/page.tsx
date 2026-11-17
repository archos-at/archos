import type { JSX } from 'react'
import { type Metadata } from 'next'
import { withPageSession } from '@/lib/auth/require-auth'
import { getSimilarProjects } from '@/lib/references/service'
import { SimilarProjects } from '@/features/references/components/similar-projects'
import { getTranslations } from '@/i18n/server'
import { settingsCopy } from '@/i18n/namespaces/settings'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(settingsCopy)
  return { title: t('project.nav.references') }
}

export default async function ProjectReferencesPage({ params }: PageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const { id } = await params
    const page = await getSimilarProjects(session, id)
    return <SimilarProjects projectId={id} page={page} />
  })
}
