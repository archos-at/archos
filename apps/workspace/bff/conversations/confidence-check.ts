/**
 * What the answer check found (`TurnResult.confidence_check`,
 * `packages/agent/src/agent/common/claim_judge.py`, ADR-0139), made durable.
 *
 * One model call grades the final answer against everything the turn
 * registered. `judged`: the chip shows the level and names the statements the
 * answer relies on that the evidence does not back or contradicts. `unavailable`:
 * the check could not run and the turn has no level, which the chip says; its
 * `unavailableReason` says why (`claim_judge.Unavailable`: no model, a timeout,
 * an error, an unparseable or an empty reply, with the call's elapsed time and
 * prompt size). Nobody sees the reason as a level: it is for operators and the
 * eval, read off the stored message.
 *
 * Like the claim stamps it lands in message provenance (jsonb, written by the
 * browser and by the agent tier), so the key set is closed and every string is
 * capped on write and again on read.
 */

export const CHECK_STATUSES = ['judged', 'unavailable'] as const
export type ConfidenceCheckStatus = (typeof CHECK_STATUSES)[number]

const LEVELS = ['low', 'medium', 'high'] as const
const PROBLEMS = ['unbacked', 'contradicted'] as const
const CAUSES = ['no_judge', 'timeout', 'error', 'unparseable', 'no_reply'] as const

export interface ConfidenceFinding {
  /** The statement as the answer words it, shortened to one line. */
  statement: string
  problem: (typeof PROBLEMS)[number]
  /** One line: what the evidence says instead, or that it says nothing about it. */
  reason: string
  /** The evidence it was checked against; `none` when nothing addressed it. */
  source: string
}

/** Why an `unavailable` check gave no level (`ConfidenceUnavailable` on the wire). */
export interface ConfidenceUnavailableReason {
  cause: (typeof CAUSES)[number]
  /** `error`: the exception's class name. */
  errorType?: string
  finishReason?: string
  /** The reply stopped at the check's output budget. */
  truncated?: boolean
  elapsedMs?: number
  evidenceChars?: number
  answerChars?: number
}

export interface ConfidenceCheck {
  status: ConfidenceCheckStatus
  level?: (typeof LEVELS)[number]
  findings: ConfidenceFinding[]
  unavailableReason?: ConfidenceUnavailableReason
}

/** The check names at most eight; more is a runaway producer. */
const MAX_FINDINGS = 8

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined

function sanitizeFinding(input: unknown): ConfidenceFinding | undefined {
  if (!isRecord(input)) return undefined
  const statement = cap(input.statement, 300)
  const problem = oneOf(input.problem, PROBLEMS)
  if (!statement || !problem) return undefined
  return { statement, problem, reason: cap(input.reason, 300) ?? '', source: cap(input.source, 200) ?? 'none' }
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined

/**
 * The reason, bounded. The wire and the agent tier's metadata spell it in
 * snake case (`unavailable_reason`), the browser's provenance in camel case;
 * both read, camel case is written.
 */
function sanitizeUnavailableReason(input: unknown): ConfidenceUnavailableReason | undefined {
  if (!isRecord(input)) return undefined
  const cause = oneOf(input.cause, CAUSES)
  if (!cause) return undefined
  const errorType = cap(input.errorType ?? input.error_type, 100)
  const finishReason = cap(input.finishReason ?? input.finish_reason, 40)
  const elapsedMs = count(input.elapsedMs ?? input.elapsed_ms)
  const evidenceChars = count(input.evidenceChars ?? input.evidence_chars)
  const answerChars = count(input.answerChars ?? input.answer_chars)
  return {
    cause,
    ...(errorType && { errorType }),
    ...(finishReason && { finishReason }),
    ...(input.truncated === true && { truncated: true }),
    ...(elapsedMs !== undefined && { elapsedMs }),
    ...(evidenceChars !== undefined && { evidenceChars }),
    ...(answerChars !== undefined && { answerChars }),
  }
}

/** The check, bounded, or undefined when it is no such object. */
export function sanitizeConfidenceCheck(input: unknown): ConfidenceCheck | undefined {
  if (!isRecord(input)) return undefined
  const status = oneOf(input.status, CHECK_STATUSES)
  if (!status) return undefined
  const findings = Array.isArray(input.findings)
    ? input.findings
        .slice(0, MAX_FINDINGS)
        .map(sanitizeFinding)
        .filter((finding): finding is ConfidenceFinding => finding !== undefined)
    : []
  const level = oneOf(input.level, LEVELS)
  if (status === 'judged' && level) return { status, level, findings }
  const unavailableReason = sanitizeUnavailableReason(input.unavailableReason ?? input.unavailable_reason)
  return { status: 'unavailable', findings: [], ...(unavailableReason && { unavailableReason }) }
}
