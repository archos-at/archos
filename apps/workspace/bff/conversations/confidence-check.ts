export const CHECK_STATUSES = ['judged', 'unavailable'] as const
export type ConfidenceCheckStatus = (typeof CHECK_STATUSES)[number]

const LEVELS = ['low', 'medium', 'high'] as const
const PROBLEMS = ['unbacked', 'contradicted'] as const
const CAUSES = ['no_judge', 'timeout', 'error', 'unparseable', 'no_reply'] as const

export interface ConfidenceFinding {
  statement: string
  problem: (typeof PROBLEMS)[number]
  reason: string
  source: string
}

export interface ConfidenceUnavailableReason {
  cause: (typeof CAUSES)[number]
  errorType?: string
  finishReason?: string
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
