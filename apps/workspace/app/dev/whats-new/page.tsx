/**
 * Dev preview for What's new (`/app/whats-new`, ADR-0156). Not linked anywhere and 404s outside
 * development. Shows two weeks from the fixture: the area filter with its counts, a week without a
 * summary (the current one), a summarised week, the sections, and the fixes folded. `?area=documents`
 * shows the filtered form, with the area labels dropped. `?notice=1` adds the one-time
 * "Neu diese Woche" notice with the fixture's summarised week, in its corner.
 *
 * `?data=real` reads the committed release notes instead of the fixture, with `area` and `cursor`
 * working as on the real page. The fixture has five notes; a real week has a hundred, and the page
 * is designed for that density, so judge a change to it there.
 */

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
