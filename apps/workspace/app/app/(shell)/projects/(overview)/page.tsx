import type { JSX } from 'react'
import { type Metadata } from 'next'
import { getTranslations } from '@/i18n/server'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { ProjectOverviewSheet } from '../project-overview-sheet'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(projectsCopy)
  return { title: t('portfolio.title') }
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }): Promise<JSX.Element> {
  const { new: newParam } = await searchParams
  return <ProjectOverviewSheet standalone autoOpenCreate={newParam === '1'} />
}
