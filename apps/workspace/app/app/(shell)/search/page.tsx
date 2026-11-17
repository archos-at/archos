import type { JSX } from 'react'
import { Suspense } from 'react'
import { type Metadata } from 'next'

import { ShellContent } from '@/components/shell/shell-content'
import { PageHeader } from '@/components/ui/page-header'
import { SearchWorkspace } from '@/features/search'
import { getTranslations } from '@/i18n/server'
import { searchCopy } from '@/i18n/namespaces/search'
import { withPageSession } from '@/lib/auth/require-auth'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(searchCopy)
  return { title: t('title') }
}

export default async function SearchPage(): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    const t = await getTranslations(searchCopy)
    return (
      <ShellContent width="tool">
        <PageHeader className="mb-6" title={t('title')} />
        <Suspense fallback={null}>
          <SearchWorkspace surface={{ kind: 'office' }} currentUserId={session.userId} autoFocus />
        </Suspense>
      </ShellContent>
    )
  })
}
