import type { ChangeRequestSummary, CountryCoverage } from '@/lib/base-knowledge/platform/wire'

export type CountryStage = 'not_started' | 'in_progress' | 'published'

export type CountryNextStep =
  | { kind: 'review'; count: number }
  | { kind: 'check_editions'; count: number }
  | { kind: 'continue_drafts'; count: number }
  | { kind: 'start' }
  | { kind: 'none' }

export const COUNTRY_SECTIONS = ['overview', 'works', 'sources', 'rules', 'review', 'quality'] as const
export type CountrySection = (typeof COUNTRY_SECTIONS)[number]

export function isCountrySection(value: string | null): value is CountrySection {
  return value !== null && (COUNTRY_SECTIONS as readonly string[]).includes(value)
}

export const releasedTotal = (coverage: CountryCoverage): number =>
  Object.values(coverage.released).reduce((sum, count) => sum + count, 0)

export function countryStage(coverage: CountryCoverage, queue: readonly ChangeRequestSummary[] = []): CountryStage {
  if (releasedTotal(coverage) > 0) return 'published'
  return coverage.openRequests > 0 || awaitingReview(queue, coverage.countryId).length > 0 ? 'in_progress' : 'not_started'
}

export function awaitingReview(queue: readonly ChangeRequestSummary[], countryId: string): ChangeRequestSummary[] {
  return queue.filter((request) => request.countryId === countryId)
}

export function countryNextStep(coverage: CountryCoverage, queue: readonly ChangeRequestSummary[]): CountryNextStep {
  const waiting = awaitingReview(queue, coverage.countryId).length
  if (waiting > 0) return { kind: 'review', count: waiting }
  if (coverage.overdueEditions > 0) return { kind: 'check_editions', count: coverage.overdueEditions }
  if (coverage.openRequests > 0) return { kind: 'continue_drafts', count: coverage.openRequests }
  if (releasedTotal(coverage) === 0) return { kind: 'start' }
  return { kind: 'none' }
}

export function sectionOf(step: CountryNextStep): CountrySection {
  if (step.kind === 'review' || step.kind === 'continue_drafts') return 'review'
  if (step.kind === 'check_editions') return 'works'
  return 'overview'
}

export type RequestGroup = 'waiting' | 'drafts' | 'to_publish' | 'done'

export const REQUEST_GROUPS: readonly RequestGroup[] = ['waiting', 'drafts', 'to_publish', 'done']

export function requestGroup(request: ChangeRequestSummary): RequestGroup {
  if (request.status === 'submitted') return 'waiting'
  if (request.secondReview?.state === 'due' && request.status !== 'rejected') return 'waiting'
  if (request.status === 'draft') return 'drafts'
  if (request.status === 'approved') return 'to_publish'
  return 'done'
}
