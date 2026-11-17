import 'server-only'
import { LangfuseClient } from '@langfuse/client'
import { langfuseApiConfig, type LangfuseApiConfig } from './config'

export const FEEDBACK_SCORE_NAME = 'user-feedback'

export const FEEDBACK_REASON_SCORE_NAME = 'user-feedback-reason'

export const FALLBACK_REASON = 'other'

export const REVIEW_QUEUE_NAME = 'answer-review'

export const QUEUE_CACHE_TTL_MS = 10 * 60 * 1000

export const SCORE_DEADLINE_MS = 5000
const ATTEMPT_TIMEOUT_SECONDS = 3
const MAX_RETRIES = 1

const QUEUE_PAGE_SIZE = 100
const MAX_QUEUE_PAGES = 10

type ScoreRequest = Parameters<LangfuseClient['api']['scores']['create']>[0]

export interface FeedbackScoreInput {
  feedbackId: string
  traceId: string
  verdict: 'up' | 'down'
  reason: string | null
  comment: string | null
  expectedAnswer: string | null
  previousVerdict?: 'up' | 'down' | null
}

export function feedbackScoreId(feedbackId: string): string {
  return `${FEEDBACK_SCORE_NAME}-${feedbackId}`
}

export function feedbackReasonScoreId(feedbackId: string): string {
  return `${FEEDBACK_REASON_SCORE_NAME}-${feedbackId}`
}

function scoreComment(input: FeedbackScoreInput): string | undefined {
  const lines = [
    input.reason ? `reason: ${input.reason}` : null,
    input.comment?.trim() || null,
    input.expectedAnswer?.trim() ? `expected: ${input.expectedAnswer.trim()}` : null,
  ].filter((line): line is string => Boolean(line))
  return lines.length > 0 ? lines.join('\n') : undefined
}

export function toFeedbackScore(input: FeedbackScoreInput): ScoreRequest {
  return {
    id: feedbackScoreId(input.feedbackId),
    traceId: input.traceId,
    name: FEEDBACK_SCORE_NAME,
    dataType: 'NUMERIC',
    value: input.verdict === 'up' ? 1 : 0,
    comment: scoreComment(input),
    metadata: {
      verdict: input.verdict,
      reason: input.reason,
      ...(input.expectedAnswer?.trim() ? { expected_answer: input.expectedAnswer.trim() } : {}),
    },
  }
}

export function toFeedbackReasonScore(input: FeedbackScoreInput): ScoreRequest | null {
  if (input.verdict !== 'down') return null
  return {
    id: feedbackReasonScoreId(input.feedbackId),
    traceId: input.traceId,
    name: FEEDBACK_REASON_SCORE_NAME,
    dataType: 'CATEGORICAL',
    value: input.reason ?? FALLBACK_REASON,
    metadata: { verdict: input.verdict, reason: input.reason },
  }
}

export function shouldEnqueueForReview(input: FeedbackScoreInput): boolean {
  return input.verdict === 'down' && input.previousVerdict !== 'down'
}

let cached: { key: string; client: LangfuseClient } | null = null

const configKey = (config: LangfuseApiConfig): string =>
  `${config.baseUrl}\u0000${config.publicKey}\u0000${config.secretKey}`

export function clientFor(config: LangfuseApiConfig): LangfuseClient {
  const key = configKey(config)
  if (cached?.key !== key) {
    cached = {
      key,
      client: new LangfuseClient({
        publicKey: config.publicKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        timeout: ATTEMPT_TIMEOUT_SECONDS,
      }),
    }
  }
  return cached.client
}

const requestOptions = () => ({
  timeoutInSeconds: ATTEMPT_TIMEOUT_SECONDS,
  maxRetries: MAX_RETRIES,
  abortSignal: AbortSignal.timeout(SCORE_DEADLINE_MS),
})

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'statusCode' in error && error.statusCode === 404
}

function quietly(what: string, subject: string, work: () => Promise<unknown>): Promise<void> {
  return work().then(
    () => undefined,
    (error: unknown) => {
      console.warn(`[Langfuse] ${what} failed for ${subject} (non-fatal):`, error)
    }
  )
}

const inFlight = new Map<string, Promise<void>>()

function serialized(scoreId: string, what: string, work: () => Promise<unknown>): Promise<void> {
  const previous = inFlight.get(scoreId) ?? Promise.resolve()
  const next = previous.then(() => quietly(what, `score ${scoreId}`, work))
  inFlight.set(scoreId, next)
  void next.finally(() => {
    if (inFlight.get(scoreId) === next) inFlight.delete(scoreId)
  })
  return next
}

export function upsertScore(config: LangfuseApiConfig, scoreId: string, score: ScoreRequest): Promise<void> {
  return serialized(scoreId, 'score upsert', () =>
    clientFor(config).api.scores.create(score, requestOptions())
  )
}

function deleteScore(config: LangfuseApiConfig, scoreId: string): Promise<void> {
  return serialized(scoreId, 'score delete', async () => {
    try {
      await clientFor(config).api.legacy.scoreV1.delete(scoreId, requestOptions())
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  })
}

let queueLookup: { key: string; queueId: string | null; expiresAt: number } | null = null
let pendingLookup: { key: string; promise: Promise<string | null> } | null = null
let queueMissLogged = false

async function findReviewQueueId(client: LangfuseClient): Promise<string | null> {
  for (let page = 1; page <= MAX_QUEUE_PAGES; page += 1) {
    const { data, meta } = await client.api.annotationQueues.listQueues(
      { page, limit: QUEUE_PAGE_SIZE },
      requestOptions()
    )
    const match = data.find((queue) => queue.name === REVIEW_QUEUE_NAME)
    if (match) return match.id
    if (page >= meta.totalPages) return null
  }
  return null
}

function rememberLookup(key: string, queueId: string | null): void {
  queueLookup = { key, queueId, expiresAt: Date.now() + QUEUE_CACHE_TTL_MS }
  if (queueId) {
    queueMissLogged = false
  } else if (!queueMissLogged) {
    queueMissLogged = true
    console.warn(
      `[Langfuse] No annotation queue named "${REVIEW_QUEUE_NAME}"; down-votes are not queued for review ` +
        '(run `task langfuse:provision`).'
    )
  }
}

function resolveReviewQueueId(config: LangfuseApiConfig): Promise<string | null> {
  const key = configKey(config)
  if (queueLookup?.key === key && queueLookup.expiresAt > Date.now()) {
    return Promise.resolve(queueLookup.queueId)
  }
  if (pendingLookup?.key === key) return pendingLookup.promise
  const promise = findReviewQueueId(clientFor(config)).then((queueId) => {
    rememberLookup(key, queueId)
    return queueId
  })
  pendingLookup = { key, promise }
  void promise
    .finally(() => {
      if (pendingLookup?.promise === promise) pendingLookup = null
    })
    .catch(() => undefined)
  return promise
}

function enqueueForReview(config: LangfuseApiConfig, traceId: string): Promise<void> {
  return quietly('review enqueue', `trace ${traceId}`, async () => {
    const queueId = await resolveReviewQueueId(config)
    if (!queueId) return
    await clientFor(config).api.annotationQueues.createQueueItem(
      queueId,
      { objectId: traceId, objectType: 'TRACE' },
      requestOptions()
    )
  })
}

export function resetReviewQueueCacheForTests(): void {
  queueLookup = null
  pendingLookup = null
  queueMissLogged = false
}

export async function upsertFeedbackScore(input: FeedbackScoreInput): Promise<boolean> {
  const config = langfuseApiConfig()
  if (!config) return false
  const reasonScore = toFeedbackReasonScore(input)
  const reasonScoreId = feedbackReasonScoreId(input.feedbackId)
  await Promise.all([
    upsertScore(config, feedbackScoreId(input.feedbackId), toFeedbackScore(input)),
    reasonScore
      ? upsertScore(config, reasonScoreId, reasonScore)
      : deleteScore(config, reasonScoreId),
    shouldEnqueueForReview(input) ? enqueueForReview(config, input.traceId) : Promise.resolve(),
  ])
  return true
}

export async function deleteFeedbackScore(feedbackId: string): Promise<boolean> {
  const config = langfuseApiConfig()
  if (!config) return false
  await Promise.all([
    deleteScore(config, feedbackScoreId(feedbackId)),
    deleteScore(config, feedbackReasonScoreId(feedbackId)),
  ])
  return true
}

export function feedbackScoringEnabled(): boolean {
  return langfuseApiConfig() !== null
}
