/**
 * „Mein Gedächtnis“: the notes the agent keeps about the signed-in person
 * (ADR-0180), outside any project. The notes are read in the browser through
 * the person's own session (`/api/user/memory`), where row-level security on
 * the person holds them; the server renders the frame only.
 */

import type { JSX } from 'react'
import { BackLink, ShellContent } from '@/components/shell'
import { PageHeader } from '@/components/ui/page-header'
import { PersonalMemoryPanel } from '@/features/personal-memory'
import { getTranslations } from '@/i18n/server'
import { personalMemoryCopy } from '@/i18n/namespaces/personal-memory'
import { withPageSession } from '@/lib/auth/require-auth'

export default async function PersonalMemoryPage(): Promise<JSX.Element> {
  return withPageSession(async () => {
    const t = await getTranslations(personalMemoryCopy)
    return (
      <ShellContent>
        <BackLink className="touch-target mb-6" fallbackHref="/app/projects" fallbackLabel={t('backToApp')} />
        <PageHeader className="mb-8" title={t('title')} subtitle={t('subtitle')} />
        <PersonalMemoryPanel />
      </ShellContent>
    )
  })
}
