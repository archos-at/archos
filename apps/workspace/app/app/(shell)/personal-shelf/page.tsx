import type { JSX } from 'react'
import { type Metadata } from 'next'
import { withPageSession } from '@/lib/auth/require-auth'
import { isIfcModelsEnabled } from '@/lib/authz/feature-flags'
import { getTranslations } from '@/i18n/server'
import { filesCopy } from '@/i18n/namespaces/files'
import { PersonalShelfWorkspace } from '@/features/documents/components/personal-shelf-workspace'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(filesCopy)
  return { title: t('personalShelf.title') }
}

export default function PersonalShelfPage(): Promise<JSX.Element> {
  return withPageSession((session) => (
    <PersonalShelfWorkspace userId={session.userId} showModels={isIfcModelsEnabled(session)} />
  ))
}
