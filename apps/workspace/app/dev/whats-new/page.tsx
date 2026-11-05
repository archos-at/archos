'use client'

/**
 * Dev preview for What's new (`/app/whats-new`, ADR-0156). Not linked anywhere and 404s outside
 * development. Shows two weeks from the fixture: the area filter with its counts, a week without a
 * summary (the current one), a summarised week, the sections, and the fixes folded. `?area=documents`
 * shows the filtered form, with the area chips dropped from the rows. `?notice=1` adds the
 * one-time "Neu diese Woche" notice with the fixture's summarised week, in its corner.
 */

import type { JSX } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { WhatsNewList, WhatsNewNotice } from '@/features/whats-new/components'
import { WHATS_NEW_FIXTURE } from '@/features/whats-new/components/fixtures'
import type { ReleaseNoteArea } from '@/lib/release-notes/release-notes-wire'

export default function WhatsNewDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const params = useSearchParams()
  const area = (params?.get('area') ?? null) as ReleaseNoteArea | null
  const summarised = WHATS_NEW_FIXTURE.weeks[1]
  const notice =
    params?.get('notice') && summarised.summary && summarised.date && summarised.dateEnd
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
  const list = area
    ? {
        ...WHATS_NEW_FIXTURE,
        area,
        weeks: WHATS_NEW_FIXTURE.weeks
          .map((week) => ({ ...week, summary: null, notes: week.notes.filter((note) => note.area === area) }))
          .filter((week) => week.notes.length > 0),
      }
    : WHATS_NEW_FIXTURE
  return (
    <main className="bg-background mx-auto max-w-3xl p-6">
      <WhatsNewList list={list} basePath="/dev/whats-new" />
      <WhatsNewNotice state={notice} href="/dev/whats-new" />
    </main>
  )
}
