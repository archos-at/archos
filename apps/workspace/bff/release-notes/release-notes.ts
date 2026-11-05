/**
 * What changed in the product, for signed-in members: the customer tier of the release notes
 * (ADR-0154).
 *
 * The data is `release-notes.generated.json`, written by `scripts/release_notes.py publish` from the
 * reno notes and committed by the release-notes workflow on every merge to `develop`, like the
 * website's public changelog. It is bundled with the app rather than read at run time: the notes
 * are the same for every office, need git history to build, and change only when the image does.
 * It holds no tenant data, which is why reading it needs a session and nothing else.
 */

import 'server-only'

import artifact from './release-notes.generated.json'
import {
  RELEASE_NOTE_AREAS,
  WEEKS_PER_PAGE,
  type ReleaseNoteArea,
  type ReleaseNoteListQuery,
  type ReleaseNoteSection,
} from './release-notes-wire'

/** One string in both product languages. */
export interface Bilingual {
  readonly en: string
  readonly de: string
}

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
  readonly page: number
  readonly pageCount: number
  /** Every area with how many notes it has across all weeks, in the vocabulary's order. */
  readonly areas: readonly { readonly id: ReleaseNoteArea; readonly count: number }[]
  readonly weeks: readonly ReleaseNoteWeek[]
}

const DATA = artifact as unknown as ReleaseNoteArtifact

/**
 * One page of weeks, newest first, optionally narrowed to one area. Narrowed, a week keeps only the
 * notes in that area and drops out when none is left; its summary goes with it, because a summary
 * speaks for the whole week.
 */
export function listReleaseNotes(query: ReleaseNoteListQuery = {}, source: ReleaseNoteArtifact = DATA): ReleaseNoteList {
  const area = query.area ?? null
  const weeks = area
    ? source.releases
        .map((week) => ({ ...week, summary: null, notes: week.notes.filter((note) => note.area === area) }))
        .filter((week) => week.notes.length > 0)
    : source.releases
  const pageCount = Math.max(1, Math.ceil(weeks.length / WEEKS_PER_PAGE))
  const page = Math.min(query.page ?? 1, pageCount)
  return {
    area,
    page,
    pageCount,
    areas: RELEASE_NOTE_AREAS.map((id) => ({
      id,
      count: source.releases.reduce((sum, week) => sum + week.notes.filter((note) => note.area === id).length, 0),
    })),
    weeks: weeks.slice((page - 1) * WEEKS_PER_PAGE, page * WEEKS_PER_PAGE),
  }
}

/** The artifact as committed, for the specs that hold it to the vocabulary. */
export const releaseNoteArtifact = (): ReleaseNoteArtifact => DATA
