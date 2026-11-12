/**
 * Where a country stands, in the words an operator acts on (Platform → Länder).
 * Pure: the list and the country page read the same two answers, the stage and
 * the one next step, from the overview the BFF already serves.
 */

import type { ChangeRequestSummary, CountryCoverage } from '@/lib/base-knowledge/platform/wire'

/** Nothing released and nothing open; work under way; something released to offices. */
export type CountryStage = 'not_started' | 'in_progress' | 'published'

/**
 * The one thing to do next, most urgent first: a request waits for a reviewer, released editions are past
 * their check, work is open, nothing has started; or nothing is due.
 */
export type CountryNextStep =
  | { kind: 'review'; count: number }
  | { kind: 'check_editions'; count: number }
  | { kind: 'continue_drafts'; count: number }
  | { kind: 'start' }
  | { kind: 'none' }

/** The sections of one country's page, in the order the work runs. */
export const COUNTRY_SECTIONS = ['overview', 'works', 'sources', 'rules', 'review', 'quality'] as const
export type CountrySection = (typeof COUNTRY_SECTIONS)[number]

export function isCountrySection(value: string | null): value is CountrySection {
  return value !== null && (COUNTRY_SECTIONS as readonly string[]).includes(value)
}

export const releasedTotal = (coverage: CountryCoverage): number =>
  Object.values(coverage.released).reduce((sum, count) => sum + count, 0)

/** A request waiting for review is work under way, whether or not the overview counts it as open. */
export function countryStage(coverage: CountryCoverage, queue: readonly ChangeRequestSummary[] = []): CountryStage {
  if (releasedTotal(coverage) > 0) return 'published'
  return coverage.openRequests > 0 || awaitingReview(queue, coverage.countryId).length > 0 ? 'in_progress' : 'not_started'
}

/** What waits for a reviewer in this country: submitted, or approved alone with its second review due. */
export function awaitingReview(queue: readonly ChangeRequestSummary[], countryId: string): ChangeRequestSummary[] {
  return queue.filter((request) => request.countryId === countryId)
}

export function countryNextStep(coverage: CountryCoverage, queue: readonly ChangeRequestSummary[]): CountryNextStep {
  const waiting = awaitingReview(queue, coverage.countryId).length
  if (waiting > 0) return { kind: 'review', count: waiting }
  if (coverage.overdueEditions > 0) return { kind: 'check_editions', count: coverage.overdueEditions }
  // Open requests outside the queue are drafts, or approved ones still to publish: work under way.
  if (coverage.openRequests > 0) return { kind: 'continue_drafts', count: coverage.openRequests }
  if (releasedTotal(coverage) === 0) return { kind: 'start' }
  return { kind: 'none' }
}

/** The section a next step is done in. */
export function sectionOf(step: CountryNextStep): CountrySection {
  if (step.kind === 'review' || step.kind === 'continue_drafts') return 'review'
  if (step.kind === 'check_editions') return 'works'
  return 'overview'
}

/** Where one change request sits on the review section: what to do with it now, or done. */
export type RequestGroup = 'waiting' | 'drafts' | 'to_publish' | 'done'

export const REQUEST_GROUPS: readonly RequestGroup[] = ['waiting', 'drafts', 'to_publish', 'done']

export function requestGroup(request: ChangeRequestSummary): RequestGroup {
  if (request.status === 'submitted') return 'waiting'
  if (request.secondReview?.state === 'due' && request.status !== 'rejected') return 'waiting'
  if (request.status === 'draft') return 'drafts'
  if (request.status === 'approved') return 'to_publish'
  return 'done'
}
