import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { WhatsNewList, WhatsNewNotice } from '@/features/whats-new/components'
import { WHATS_NEW_FIXTURE } from '@/features/whats-new/components/fixtures'
import { getLocale } from '@/i18n/server'
import { listReleaseNotes, localizeReleaseNotes } from '@/lib/release-notes/release-notes'
import {
  releaseNoteListQuerySchema,
  type LocalizedReleaseNoteList,
  type ReleaseNoteArea,
  type ReleaseNoteListQuery,
} from '@/lib/release-notes/release-notes-wire'

interface WhatsNewDevPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function fixtureList(area: ReleaseNoteArea | null): LocalizedReleaseNoteList {
  if (!area) return WHATS_NEW_FIXTURE
  return {
    ...WHATS_NEW_FIXTURE,
    area,
    weeks: WHATS_NEW_FIXTURE.weeks
      .map((week) => ({ ...week, summary: null, notes: week.notes.filter((note) => note.area === area) }))
      .filter((week) => week.notes.length > 0),
  }
}

export default async function WhatsNewDevPage({ searchParams }: WhatsNewDevPageProps): Promise<JSX.Element> {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const params = await searchParams
  const real = params.data === 'real'
  const parsed = releaseNoteListQuerySchema.safeParse({ area: params.area, cursor: params.cursor })
  const query: ReleaseNoteListQuery = parsed.success ? parsed.data : {}
  const list = real ? localizeReleaseNotes(listReleaseNotes(query), await getLocale()) : fixtureList(query.area ?? null)

  const summarised = WHATS_NEW_FIXTURE.weeks[1]
  const notice =
    params.notice && summarised.summary && summarised.date && summarised.dateEnd
      ? {
          summary: {
            id: summarised.id,
            date: summarised.date,
            dateEnd: summarised.dateEnd,
            summary: { en: summarised.summary, de: summarised.summary },
          },
          quietly: false,
        }
      : null
  return (
    <main className="bg-background mx-auto max-w-5xl px-4 py-8 md:px-8">
      <WhatsNewList list={list} basePath="/dev/whats-new" query={real ? { data: 'real' } : undefined} />
      <WhatsNewNotice state={notice} href="/dev/whats-new" />
    </main>
  )
}
