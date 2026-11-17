import 'server-only'

import artifact from './release-notes.generated.json'
import type { Locale } from '@/i18n/config'
import {
  RELEASE_NOTE_AREAS,
  WEEKS_PER_PAGE,
  type Bilingual,
  type LocalizedReleaseNoteList,
  type ReleaseNoteArea,
  type ReleaseNoteListQuery,
  type ReleaseNoteSection,
} from './release-notes-wire'

export interface ReleaseNote {
  readonly section: ReleaseNoteSection
  readonly area: ReleaseNoteArea
  readonly text: Bilingual
}

export interface ReleaseNoteWeek {
  readonly id: string
  readonly kind: 'week' | 'version'
  readonly version: string | null
  readonly date: string | null
  readonly dateEnd: string | null
  readonly summary: Bilingual | null
  readonly notes: readonly ReleaseNote[]
}

export interface ReleaseNoteArtifact {
  readonly sections: readonly ReleaseNoteSection[]
  readonly areas: readonly ReleaseNoteArea[]
  readonly releases: readonly ReleaseNoteWeek[]
}

export interface ReleaseNoteList {
  readonly area: ReleaseNoteArea | null
  readonly cursor: string | null
  readonly nextCursor: string | null
  readonly areas: readonly { readonly id: ReleaseNoteArea; readonly count: number }[]
  readonly weeks: readonly ReleaseNoteWeek[]
}

export type { Bilingual }

const DATA = artifact as unknown as ReleaseNoteArtifact

export function listReleaseNotes(query: ReleaseNoteListQuery = {}, source: ReleaseNoteArtifact = DATA): ReleaseNoteList {
  const area = query.area ?? null
  const limit = query.limit ?? WEEKS_PER_PAGE
  const weeks = area
    ? source.releases
        .map((week) => ({ ...week, summary: null, notes: week.notes.filter((note) => note.area === area) }))
        .filter((week) => week.notes.length > 0)
    : source.releases
  const after = query.cursor ? weeks.findIndex((week) => week.id === query.cursor) : -1
  const start = after + 1
  const page = weeks.slice(start, start + limit)
  const hasMore = start + limit < weeks.length
  return {
    area,
    cursor: after >= 0 ? (query.cursor ?? null) : null,
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
    areas: RELEASE_NOTE_AREAS.map((id) => ({
      id,
      count: source.releases.reduce((sum, week) => sum + week.notes.filter((note) => note.area === id).length, 0),
    })),
    weeks: page,
  }
}

export function localizeReleaseNotes(list: ReleaseNoteList, locale: Locale): LocalizedReleaseNoteList {
  return {
    ...list,
    weeks: list.weeks.map((week) => ({
      ...week,
      summary: week.summary ? week.summary[locale] : null,
      notes: week.notes.map((note) => ({ ...note, text: note.text[locale] })),
    })),
  }
}

export const releaseNoteArtifact = (): ReleaseNoteArtifact => DATA
