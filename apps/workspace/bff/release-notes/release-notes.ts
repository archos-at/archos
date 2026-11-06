/**
 * What changed in the product, for signed-in members: the customer tier of the release notes
 * (ADR-0156).
 *
 * The data is `release-notes.generated.json`, written by `scripts/release_notes.py publish` from the
 * reno notes and committed by the release-notes workflow on every merge to `develop`, like the
 * website's public changelog. It is bundled with the app rather than read at run time: the notes
 * are the same for every office, need git history to build, and change only when the image does.
 * It holds no tenant data, which is why reading it needs a session and nothing else.
 */

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

/** A week (or, once releases are tagged, a version) and the notes that shipped in it. */
export interface ReleaseNoteWeek {
  /** `2026-W44`, or a version such as `1.2.0`. */
  readonly id: string
  readonly kind: 'week' | 'version'
  readonly version: string | null
  /** The week's Monday or the version's day, `YYYY-MM-DD`. */
  readonly date: string | null
  /** The week's Sunday; null for a version. */
  readonly dateEnd: string | null
  /** The week's editorial summary, the one the public website shows; null until someone writes it. */
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
  /** The cursor this page was asked with; null on the newest page. */
  readonly cursor: string | null
  /** Pass as `cursor` for the next, older page; null on the last. */
  readonly nextCursor: string | null
  /** Every area with how many notes it has across all weeks, in the vocabulary's order. */
  readonly areas: readonly { readonly id: ReleaseNoteArea; readonly count: number }[]
  readonly weeks: readonly ReleaseNoteWeek[]
}

export type { Bilingual }

const DATA = artifact as unknown as ReleaseNoteArtifact

/**
 * One page of weeks, newest first, optionally narrowed to one area. Narrowed, a week keeps only the
 * notes in that area and drops out when none is left; its summary goes with it, because a summary
 * speaks for the whole week. The cursor is the id of the last week of the previous page; one that
 * names no week starts from the newest.
 */
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

/** A page of the list in the reader's language: the page sends only the text it shows. */
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

/** The artifact as committed, for the specs that hold it to the vocabulary. */
export const releaseNoteArtifact = (): ReleaseNoteArtifact => DATA
