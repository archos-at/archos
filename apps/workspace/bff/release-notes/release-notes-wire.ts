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

export const WEEKS_PER_PAGE = 4
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
export type ReleaseNoteListQuery = Partial<z.output<typeof releaseNoteListQuerySchema>>

export interface LocalizedReleaseNote {
  readonly section: ReleaseNoteSection
  readonly area: ReleaseNoteArea
  readonly text: string
}

export interface LocalizedReleaseNoteWeek {
  readonly id: string
  readonly kind: 'week' | 'version'
  readonly version: string | null
  readonly date: string | null
  readonly dateEnd: string | null
  readonly summary: string | null
  readonly notes: readonly LocalizedReleaseNote[]
}

export interface LocalizedReleaseNoteList {
  readonly area: ReleaseNoteArea | null
  readonly cursor: string | null
  readonly nextCursor: string | null
  readonly areas: readonly { readonly id: ReleaseNoteArea; readonly count: number }[]
  readonly weeks: readonly LocalizedReleaseNoteWeek[]
}

export interface Bilingual {
  readonly en: string
  readonly de: string
}

export const RELEASE_WEEK_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

export interface ReleaseSummary {
  readonly id: string
  readonly date: string
  readonly dateEnd: string
  readonly summary: Bilingual
}

export interface WhatsNewNoticeState {
  readonly summary: ReleaseSummary
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
