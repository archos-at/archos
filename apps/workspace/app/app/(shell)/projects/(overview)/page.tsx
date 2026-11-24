import { type Metadata } from 'next'
import { getTranslations } from '@/i18n/server'
import { projectsCopy } from '@/i18n/namespaces/projects'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(projectsCopy)
  return { title: t('portfolio.title') }
}

export default function ProjectsPage(): null {
  return null
}
