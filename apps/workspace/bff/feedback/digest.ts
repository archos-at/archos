import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { getCached, invalidateCached } from '@/lib/cache'
import { createHash } from 'node:crypto'
import type { FeedbackHealth } from './repository'
import { listFeedbackTurns } from './repository'
import { writeRatingsFilters, type FeedbackQuery } from './filters'
import { fillTrendWindow, feedbackTrendDelta, MIN_TREND_VOTES } from './trend'

export const FEEDBACK_DIGEST_TTL_MS = 6 * 60 * 60 * 1000

export const FEEDBACK_DIGEST_FAILURE_TTL_MS = 60 * 1000

export const FEEDBACK_DIGEST_MIN_VOTES = 10

const SAMPLES_PER_DIRECTION = 25

const MAX_QUESTION_CHARS = 240

const DIGEST_TIMEOUT_MS = 50_000

const CACHE_VERSION = 'v4'

export interface FeedbackDigest {
  headline: string
  strengths: string[]
  concerns: string[]
  recommendation: string | null
  generatedAt: string
  windowDays: number
  votes: number
  causes?: FeedbackCause[]
}

export interface FeedbackCause {
  cause: string
  count: number
}

export interface FeedbackDigestResult {
  digest: FeedbackDigest | null
  error: string | null
}

export interface FeedbackDigestOptions {
  locale?: string
  refresh?: boolean
}

function digestKey(query: FeedbackQuery, locale: string): string {
  const { scope } = query
  const organizationIds = scope.organizationIds.length ? [...scope.organizationIds].sort().join(',') : '*'
  const narrowed = writeRatingsFilters(new URLSearchParams(), query.ratings)
  for (const project of [...scope.projectIds].sort()) narrowed.append('project', project)
  const filters = createHash('sha256').update(narrowed.toString()).digest('hex').slice(0, 16)
  return `feedback:digest:${CACHE_VERSION}:${scope.from}:${scope.to}:${organizationIds}:${filters}:${locale.slice(0, 5)}`
}

function trimQuestion(value: string | null): string | null {
  if (!value) return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > MAX_QUESTION_CHARS ? `${flat.slice(0, MAX_QUESTION_CHARS - 1)}…` : flat
}

interface BackendDigestResponse {
  headline?: string
  strengths?: string[]
  concerns?: string[]
  recommendation?: string | null
  causes?: Record<string, unknown>
  error?: string | null
}

export async function getFeedbackDigest(
  health: FeedbackHealth,
  query: FeedbackQuery,
  options: FeedbackDigestOptions = {},
): Promise<FeedbackDigestResult> {
  const locale = options.locale?.toLowerCase().startsWith('en') ? 'en' : 'de'
  const votes = health.totals.up + health.totals.down
  const key = digestKey(query, locale)

  if (votes === 0) return { digest: null, error: 'no_feedback' }
  if (votes < FEEDBACK_DIGEST_MIN_VOTES) {
    return { digest: null, error: 'too_few_votes' }
  }

  if (options.refresh) await invalidateCached(key)

  const outcome: { error: string | null } = { error: null }
  const digest = await getCached<FeedbackDigest | null>(
    key,
    FEEDBACK_DIGEST_TTL_MS,
    async () => {
      const result = await generateDigest(health, query, locale)
      outcome.error = result.error
      return result.digest
    },
    { negativeTtlMs: FEEDBACK_DIGEST_FAILURE_TTL_MS },
  )

  if (digest) return { digest, error: null }
  return { digest: null, error: outcome.error ?? 'digest_unavailable' }
}

async function generateDigest(
  health: FeedbackHealth,
  query: FeedbackQuery,
  locale: string,
): Promise<FeedbackDigestResult> {
  const [helpful, unhelpful] = await Promise.all([
    listFeedbackTurns(query, { verdict: 'up', limit: SAMPLES_PER_DIRECTION }),
    listFeedbackTurns(query, { verdict: 'down', limit: SAMPLES_PER_DIRECTION }),
  ])

  const samples = [...helpful, ...unhelpful].flatMap((turn) => {
    const question = trimQuestion(turn.question)
    if (!question) return []
    const comment = turn.verdict === 'down' ? trimQuestion(turn.comment) : null
    return [{ verdict: turn.verdict, reason: turn.reason, topics: turn.topics, question, comment }]
  })

  const delta = feedbackTrendDelta(
    fillTrendWindow(health.daily, health.windowDays, MIN_TREND_VOTES, new Date(`${health.to}T12:00:00Z`)),
  )

  const body = {
    window_days: health.windowDays,
    answers: health.answers,
    rated_answers: health.ratedAnswers,
    up: health.totals.up,
    down: health.totals.down,
    voters: health.totals.voters,
    down_voters: health.totals.downVoters,
    reasons: Object.fromEntries(health.reasons.map((entry) => [entry.reason, entry.count])),
    topics: health.topics.map((t) => ({ topic: t.topic, up: t.up, down: t.down })),
    organizations: health.organizations.map((o) => ({ up: o.up, down: o.down })),
    trend_delta_points: delta,
    samples,
    locale,
  }

  let response: Response
  try {
    response = await fetch(`${getBackendUrl()}/v1/feedback-digest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DIGEST_TIMEOUT_MS),
    })
  } catch (error) {
    console.error('[FeedbackDigest] Backend unreachable (non-fatal):', error)
    return { digest: null, error: 'backend_unreachable' }
  }

  if (!response.ok) {
    console.error('[FeedbackDigest] Backend error:', response.status)
    return { digest: null, error: 'backend_error' }
  }

  let payload: BackendDigestResponse
  try {
    payload = (await response.json()) as BackendDigestResponse
  } catch {
    return { digest: null, error: 'backend_error' }
  }

  if (payload.error) return { digest: null, error: payload.error }

  const headline = (payload.headline ?? '').trim()
  const strengths = cleanList(payload.strengths)
  const concerns = cleanList(payload.concerns)
  if (!headline && strengths.length === 0 && concerns.length === 0) {
    return { digest: null, error: 'digest_unavailable' }
  }

  return {
    digest: {
      headline,
      strengths,
      concerns,
      recommendation: (payload.recommendation ?? '').trim() || null,
      generatedAt: new Date().toISOString(),
      windowDays: health.windowDays,
      votes: health.totals.up + health.totals.down,
      causes: cleanCauses(payload.causes),
    },
    error: null,
  }
}

function cleanCauses(values: Record<string, unknown> | undefined): FeedbackCause[] {
  if (!values || typeof values !== 'object') return []
  return Object.entries(values)
    .filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) > 0)
    .map(([cause, count]) => ({ cause, count }))
    .slice(0, 10)
}

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3)
}
