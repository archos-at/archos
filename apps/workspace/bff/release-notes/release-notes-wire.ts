/**
 * The wire of the release notes route (`GET /api/release-notes`), shared by the route and its
 * catalog operation (`release-note-list`).
 *
 * The area and section ids are the release notes' own vocabulary (`scripts/release_notes_areas.py`,
 * `releasenotes/config.yaml`); `release-notes.spec.ts` holds these lists to the generated artifact,
 * so an area added there and not here fails the suite rather than the page.
 */

import { z } from 'zod'

export const RELEASE_NOTE_AREAS = [
  'projects',
  'documents',
  'answers',
  'search',
  'building-law',
  'bim',
  'collaboration',
  'tasks',
  'office-knowledge',
  'administration',
  'agents',
  'general',
] as const
export type ReleaseNoteArea = (typeof RELEASE_NOTE_AREAS)[number]

export const RELEASE_NOTE_SECTIONS = ['features', 'improvements', 'fixes', 'deprecations', 'upgrade', 'other'] as const
export type ReleaseNoteSection = (typeof RELEASE_NOTE_SECTIONS)[number]

/** Weeks a page holds by default: about a month, which is what a returning member catches up on. */
export const WEEKS_PER_PAGE = 4
/** The most weeks one page answers. */
export const WEEKS_PAGE_MAX = 26

export const releaseNoteListQuerySchema = z.object({
  area: z
    .enum(RELEASE_NOTE_AREAS)
    .optional()
    .describe('Only the changes in this product area; omit for every area.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WEEKS_PAGE_MAX)
    .default(WEEKS_PER_PAGE)
    .describe(`Weeks per page, newest first (default ${WEEKS_PER_PAGE}, most ${WEEKS_PAGE_MAX}).`),
  cursor: z
    .string()
    .min(1)
    .max(32)
    .optional()
    .describe('The previous `nextCursor`: the page starts with the week after it.'),
})
/** What a caller asks for: the parsed query, every field optional for callers inside the app. */
export type ReleaseNoteListQuery = Partial<z.output<typeof releaseNoteListQuerySchema>>

/** One note as a reader of one language sees it. */
export interface LocalizedReleaseNote {
  readonly section: ReleaseNoteSection
  readonly area: ReleaseNoteArea
  readonly text: string
}

/** One week as a reader of one language sees it: what the page renders. */
export interface LocalizedReleaseNoteWeek {
  readonly id: string
  readonly kind: 'week' | 'version'
  readonly version: string | null
  readonly date: string | null
  readonly dateEnd: string | null
  readonly summary: string | null
  readonly notes: readonly LocalizedReleaseNote[]
}

/** One page of the list, in one language. */
export interface LocalizedReleaseNoteList {
  readonly area: ReleaseNoteArea | null
  /** The cursor this page was asked with; null on the newest page. */
  readonly cursor: string | null
  /** Pass as `cursor` for the next, older page; null on the last. */
  readonly nextCursor: string | null
  readonly areas: readonly { readonly id: ReleaseNoteArea; readonly count: number }[]
  readonly weeks: readonly LocalizedReleaseNoteWeek[]
}

/** One string in both product languages. */
export interface Bilingual {
  readonly en: string
  readonly de: string
}

/**
 * An ISO week id, `2026-W44`. The same shape the `user_preferences.last_seen_release_week` CHECK
 * holds (migration 0194), and one that sorts as text: a later week is the greater string.
 */
export const RELEASE_WEEK_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

/** The newest weekly summary, as the "Neu diese Woche" notice shows it (ADR-0154, amendment). */
export interface ReleaseSummary {
  /** The week, `2026-W44`. */
  readonly id: string
  /** Its Monday and Sunday, `YYYY-MM-DD`. */
  readonly date: string
  readonly dateEnd: string
  readonly summary: Bilingual
}

/** What the shell's notice needs: the summary to show, or a week to record quietly. */
export interface WhatsNewNoticeState {
  readonly summary: ReleaseSummary
  /**
   * Record the week as seen without showing anything: the person is new here and about to be
   * given the product tour, and a "what changed" note means nothing to someone who never saw the
   * product before.
   */
  readonly quietly: boolean
}

export const releaseSummarySeenBodySchema = z.object({
  week: z
    .string()
    .regex(RELEASE_WEEK_PATTERN)
    .describe('The week whose summary the person has seen, `2026-W44`, from release-summary-unseen-get.'),
  stop: z
    .boolean()
    .optional()
    .describe('Also turn the weekly notice off for good, as the notice’s “Don’t show again” button does.'),
})

export const releaseNoticePreferenceBodySchema = z.object({
  enabled: z.boolean().describe('Whether the person is shown the newest weekly summary once, in a notice.'),
})
