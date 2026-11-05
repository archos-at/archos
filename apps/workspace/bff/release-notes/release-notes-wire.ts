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

/** Weeks per page: about a month, which is what a returning member catches up on. */
export const WEEKS_PER_PAGE = 4

export const releaseNoteListQuerySchema = z.object({
  area: z
    .enum(RELEASE_NOTE_AREAS)
    .optional()
    .describe('Only the changes in this product area; omit for every area.'),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Which page of weeks, newest first, ${WEEKS_PER_PAGE} weeks a page; 1 when omitted.`),
})
export type ReleaseNoteListQuery = z.infer<typeof releaseNoteListQuerySchema>

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
  readonly page: number
  readonly pageCount: number
  readonly areas: readonly { readonly id: ReleaseNoteArea; readonly count: number }[]
  readonly weeks: readonly LocalizedReleaseNoteWeek[]
}
