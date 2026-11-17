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
