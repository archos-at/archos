/**
 * What's new: every change to the product, for signed-in members (ADR-0156).
 *
 * The customer tier of the release notes. The public website shows one summary per week; here a
 * member reads every change, grouped by week and narrowed by product area. The data is bundled with
 * the app (`@/lib/release-notes/release-notes`), the same for every office; the server picks the
 * page, the area and the reader's language, and sends only that.
 */

import type { JSX } from 'react'
import { BackLink, ShellContent } from '@/components/shell'
import { PageHeader } from '@/components/ui/page-header'
import { WhatsNewList } from '@/features/whats-new/components'
import { getLocale, getTranslations } from '@/i18n/server'
import { whatsNewCopy } from '@/i18n/namespaces/whats-new'
import { withPageSession } from '@/lib/auth/require-auth'
import { listReleaseNotes, localizeReleaseNotes } from '@/lib/release-notes/release-notes'
import { releaseNoteListQuerySchema } from '@/lib/release-notes/release-notes-wire'

interface WhatsNewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function WhatsNewPage({ searchParams }: WhatsNewPageProps): Promise<JSX.Element> {
  return withPageSession(async () => {
    const t = await getTranslations(whatsNewCopy)
    const locale = await getLocale()
    // A hand-edited address (an area that does not exist) shows the newest page of everything.
    const parsed = releaseNoteListQuerySchema.safeParse(await searchParams)
    const list = localizeReleaseNotes(listReleaseNotes(parsed.success ? parsed.data : {}), locale)

    return (
      <ShellContent>
        <BackLink className="touch-target mb-6" fallbackHref="/app/projects" fallbackLabel={t('backToApp')} />
        <PageHeader className="mb-8" title={t('title')} subtitle={t('subtitle')} />
        <WhatsNewList list={list} />
      </ShellContent>
    )
  })
}
