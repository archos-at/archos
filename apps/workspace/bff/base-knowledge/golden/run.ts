/**
 * The golden run (ADR-0165 amendment, design §4.4): a country's golden cases,
 * released or of one change request in preview, asked through the real answer
 * path and scored.
 *
 * Each case is an ask (`askAgent`, ADR-0124): the same headless turn an outside
 * agent's `agent-ask-create` runs, as the operator, in a private conversation
 * of the operator's own organization, on that organization's budget, traced in
 * Langfuse like any turn. The one thing a golden turn has that another turn has
 * not is its site: the case states it, so the turn's context is resolved for
 * that territory and the case's facts stand where a project's would
 * (`./turn.ts`). The law it reads is the released law the operator's
 * organization is entitled to; a preview of law records answers no turn yet
 * (ADR-0165, "a head column per channel"), so `changeRequestId` chooses whose
 * cases run, never whose law.
 *
 * A run outlives a request, so the caller steps it: `start` opens the run and
 * asks the first cases, `advance` settles the asks that ended and asks the
 * next, at most {@link CONCURRENT_CASES} at once, the load the before-baseline
 * was measured under. Only the person who started a run steps it, because only
 * they read its asks.
 */

import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { askAgent, getAsk } from '@/lib/agent-asks/service'
import { isTerminalAskState, type AskView } from '@/lib/agent-asks/ask-wire'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { findMessageInConversation } from '@/lib/conversations/repository'
import { withTenant } from '@/lib/db/tenant-context'
import { isUuid } from '@/lib/ids'
import { isTraceId } from '@/lib/langfuse/config'
import { goldenDatasetRunName, recordGoldenScores } from '@/lib/langfuse/golden-run-score'
import { knowledgeContextForStatedSite } from '../context/service'
import { COVERAGE_LEVELS } from '../wire/vocab'
import { readOrganizationCountries } from '../platform/entitlements'
import { requirePlatform } from '../platform/service-gate'
import type { GoldenAnswer, GoldenCase, GoldenCaseResult, GoldenRunCaseView, GoldenRunView } from '../wire/golden-case'
import {
  changeRequestGoldenCases,
  claimCaseForAsking,
  findGoldenRun,
  finishGoldenRun,
  insertGoldenRun,
  ledgerCostUsd,
  releasedGoldenCases,
  settleCase,
  stableReleaseSeq,
  type GoldenRunState,
  type StoredGoldenCase,
} from './repository'
import { scoreGoldenCase } from './score'

/** How many cases are asked at once: the before-baseline asked in waves of four. */
export const CONCURRENT_CASES = 4

const isAuthorized = (session: UserSession): session is AuthorizedSession => typeof session.organizationId === 'string' && session.organizationId.length > 0

async function requireOperator(session: UserSession | null): Promise<AuthorizedSession> {
  const operator = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  // A golden turn is recognised in the platform organization only (`./turn.ts`), so no office's turn pays for the lookup.
  if (!isAuthorized(operator) || operator.organizationId !== (await getPlatformOrganizationId())) {
    throw new ForbiddenError('A golden run asks in the platform organization; make it your active organization and run again.')
  }
  return operator
}

async function casesFor(body: { countryId: string; changeRequestId?: string }): Promise<StoredGoldenCase[]> {
  if (!body.changeRequestId) return releasedGoldenCases(body.countryId)
  const request = await changeRequestGoldenCases(body.changeRequestId)
  if (!request) throw new NotFoundError('No change request with this id; list them first.')
  if (request.countryId !== body.countryId) throw new ConflictError(`That change request is for ${request.countryId}, not ${body.countryId}.`, { reason: 'golden-run-country-mismatch' })
  if (!request.inPreview) throw new ConflictError('Publish the change request to preview first; its golden cases run from there.', { reason: 'golden-run-not-in-preview' })
  return request.cases
}

/** Open a run of a country's golden cases and ask the first of them. */
export async function startGoldenRun(session: UserSession | null, body: { countryId: string; changeRequestId?: string; caseKeys?: string[] }): Promise<GoldenRunView> {
  const operator = await requireOperator(session)
  const countries = await readOrganizationCountries(operator.organizationId)
  if (!countries.entitled.some((entry) => entry.countryId === body.countryId)) {
    throw new ConflictError(`Your organization is not entitled to ${body.countryId}, so its turns read none of that law. Entitle it with platform-org-country-entitle, then run again.`, {
      reason: 'golden-run-not-entitled',
    })
  }
  const every = await casesFor(body)
  const wanted = body.caseKeys ? new Set(body.caseKeys) : null
  const cases = wanted ? every.filter((stored) => wanted.has(stored.golden.key)) : every
  const missing = wanted ? [...wanted].filter((key) => !every.some((stored) => stored.golden.key === key)) : []
  if (missing.length > 0) throw new NotFoundError(`No golden case ${missing.join(', ')} for ${body.countryId}.`)
  if (cases.length === 0) {
    throw new ConflictError(`${body.countryId} has no golden cases ${body.changeRequestId ? 'in that change request' : 'released'}; propose them as golden_case records first.`, {
      reason: 'golden-run-no-cases',
    })
  }
  const runId = await insertGoldenRun({
    countryId: body.countryId,
    changeRequestId: body.changeRequestId ?? null,
    askedIn: operator.organizationId,
    startedBy: operator.userId,
    releaseSeq: await stableReleaseSeq(body.countryId),
    cases,
  })
  return advance(operator, runId, 0)
}

/** Settle the asks that ended, ask the next cases, and answer the run as it stands. */
export async function advanceGoldenRun(session: UserSession | null, runId: string, waitSeconds: number): Promise<GoldenRunView> {
  return advance(await requireOperator(session), runId, waitSeconds)
}

async function requireRun(runId: string): Promise<GoldenRunState> {
  // An id of another shape names no run: the same answer as one that does not exist.
  const state = isUuid(runId) ? await findGoldenRun(runId) : null
  if (!state) throw new NotFoundError('No golden run with this id.')
  return state
}

export async function getGoldenRun(session: UserSession | null, runId: string): Promise<GoldenRunView> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  return viewOf(await requireRun(runId))
}

async function advance(operator: AuthorizedSession, runId: string, waitSeconds: number): Promise<GoldenRunView> {
  const state = await requireRun(runId)
  if (state.run.startedBy !== operator.userId || state.run.askedIn !== operator.organizationId) {
    throw new ForbiddenError('Only the person who started a golden run steps it: its questions are asked as them. Read it with platform-knowledge-golden-run-get.')
  }
  const asked = state.cases.filter((entry) => entry.askId && !entry.settledAt)
  // One wait covers every running ask: the first takes it, the rest are read as they stand.
  await Promise.all(asked.map((entry, index) => settle(operator, state, entry, index === 0 ? waitSeconds : 0)))
  const after = (await findGoldenRun(runId)) ?? state
  const running = after.cases.filter((entry) => entry.askId && !entry.settledAt).length
  const next = after.cases.filter((entry) => !entry.askId).slice(0, Math.max(0, CONCURRENT_CASES - running))
  await Promise.all(next.map((entry) => ask(operator, after, entry)))
  const final = (await findGoldenRun(runId)) ?? after
  if (final.cases.every((entry) => entry.settledAt) && !final.run.finishedAt) {
    await finishGoldenRun(runId)
    return viewOf((await findGoldenRun(runId)) ?? final)
  }
  return viewOf(final)
}

type RunCase = GoldenRunState['cases'][number]

async function ask(operator: AuthorizedSession, state: GoldenRunState, entry: RunCase): Promise<void> {
  const scope = { organizationId: operator.organizationId, userId: operator.userId }
  // `lost`: another step of the same run took the case first, so this one sends no turn and settles nothing.
  let lost = false
  const beforeTurn = async (started: { id: string; conversationId: string }) => {
    lost = !(await claimCaseForAsking(state.run.id, entry.recordId, { askId: started.id, conversationId: started.conversationId }))
    if (lost) throw new Error('the case was asked by another step of this run')
  }
  try {
    const view = await withTenant(scope, () => askAgent(operator, { question: entry.golden.question, waitSeconds: 0 }, { beforeTurn }))
    // Refused before it ran (a spent budget, a busy server): the case is settled as unanswered, with why.
    if (!lost && view.state !== 'completed' && isTerminalAskState(view.state)) {
      await settleCase(state.run.id, entry.recordId, { failure: `${view.state}: ${view.reason ?? 'no reason given'}` })
    }
  } catch (error) {
    if (!lost) await settleCase(state.run.id, entry.recordId, { failure: `not asked: ${error instanceof Error ? error.message : String(error)}` })
  }
}

/** Whether the records answer at the case's site: its gate is a coverage level above `none`. */
async function recordsReleasedAt(organizationId: string, golden: GoldenCase, countryId: string): Promise<boolean> {
  const context = await knowledgeContextForStatedSite(organizationId, { territoryId: golden.context.territoryId ?? countryId, filedOn: null })
  return (COVERAGE_LEVELS as readonly string[]).includes(context.gate.state) && context.gate.state !== 'none'
}

/** The answer of a completed ask as the scorer reads it. */
export function goldenAnswerOf(view: AskView, recordsReleased: boolean): GoldenAnswer {
  const confidence = view.answer?.confidence
  return {
    text: view.answer?.text ?? '',
    confidence: confidence ? { level: confidence.level, ...(confidence.reason ? { reason: confidence.reason } : {}) } : null,
    sources: (view.answer?.sources ?? []).map((source) => ({
      name: source.name,
      kind: source.kind,
      documentId: source.documentId,
      // An outbound address only: the link into the asker's own conversation says nothing about the source.
      ...(source.documentId.startsWith('url:') ? { url: source.url } : {}),
      ...(source.clause ? { clause: source.clause } : {}),
    })),
    recordsReleased,
  }
}

async function traceIdOf(operator: AuthorizedSession, view: AskView): Promise<string | null> {
  const messageId = view.answer?.messageId
  if (!messageId) return null
  const message = await withTenant({ organizationId: operator.organizationId, userId: operator.userId }, () => findMessageInConversation(view.conversationId, messageId))
  const traceId = (message?.metadata as { trace_id?: unknown } | null)?.trace_id
  return isTraceId(traceId) ? traceId : null
}

async function settle(operator: AuthorizedSession, state: GoldenRunState, entry: RunCase, waitSeconds: number): Promise<void> {
  if (!entry.askId) return
  let view: AskView
  try {
    view = await withTenant({ organizationId: operator.organizationId, userId: operator.userId }, () => getAsk(operator, entry.askId as string, waitSeconds))
  } catch (error) {
    await settleCase(state.run.id, entry.recordId, { failure: `the ask could not be read: ${error instanceof Error ? error.message : String(error)}` })
    return
  }
  if (!isTerminalAskState(view.state)) return
  if (view.state !== 'completed' || !view.answer) {
    await settleCase(state.run.id, entry.recordId, { failure: `${view.state}: ${view.reason ?? 'no answer'}` })
    return
  }
  const [recordsReleased, costs, traceId] = await Promise.all([
    recordsReleasedAt(operator.organizationId, entry.golden, state.run.countryId),
    ledgerCostUsd(operator.organizationId, [view.conversationId]),
    traceIdOf(operator, view),
  ])
  const scored = scoreGoldenCase(entry.golden, goldenAnswerOf(view, recordsReleased))
  const seconds = view.endedAt ? Math.round((Date.parse(view.endedAt) - Date.parse(view.createdAt)) / 100) / 10 : null
  const costUsd = costs.get(view.conversationId) ?? null
  const result: GoldenCaseResult = {
    checks: scored.checks,
    scores: { ...scored.scores, ...(seconds === null ? {} : { 'golden-seconds': seconds }), ...(costUsd === null ? {} : { 'golden-cost-usd': costUsd }) },
    unconfirmed: scored.unconfirmed,
    confidence: view.answer.confidence?.level ?? null,
    seconds,
    costUsd,
    traceId,
  }
  await settleCase(state.run.id, entry.recordId, { passed: scored.passed, result })
  // Best-effort and after the verdict is kept: Langfuse being away never costs a run its result.
  await recordGoldenScores({ runId: state.run.id, countryId: state.run.countryId, golden: entry.golden, result })
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

function caseView(entry: RunCase): GoldenRunCaseView {
  return {
    key: entry.golden.key,
    recordId: entry.recordId,
    question: entry.golden.question,
    state: entry.settledAt ? 'settled' : entry.askId ? 'asked' : 'pending',
    passed: entry.passed,
    failure: entry.failure,
    askId: entry.askId,
    result: entry.result,
  }
}

/** A run as the door answers it. Pure. */
export function viewOf(state: GoldenRunState): GoldenRunView {
  const cases = state.cases.map(caseView)
  const settled = cases.filter((entry) => entry.state === 'settled')
  const results = settled.flatMap((entry) => (entry.result ? [entry.result] : []))
  const numbers = (pick: (result: GoldenCaseResult) => number | null) => results.flatMap((result) => (pick(result) === null ? [] : [pick(result) as number]))
  return {
    runId: state.run.id,
    countryId: state.run.countryId,
    changeRequestId: state.run.changeRequestId,
    releaseSeq: state.run.releaseSeq,
    startedAt: state.run.startedAt.toISOString(),
    finishedAt: state.run.finishedAt?.toISOString() ?? null,
    summary: {
      cases: cases.length,
      pending: cases.filter((entry) => entry.state === 'pending').length,
      asked: cases.filter((entry) => entry.state === 'asked').length,
      settled: settled.length,
      passed: settled.filter((entry) => entry.passed === true).length,
      failed: settled.filter((entry) => entry.passed === false).length,
      unanswered: settled.filter((entry) => entry.failure !== null).length,
      unconfirmed: results.reduce((sum, result) => sum + result.unconfirmed, 0),
    },
    medianSeconds: median(numbers((result) => result.seconds)),
    medianCostUsd: median(numbers((result) => result.costUsd)),
    datasetRun: goldenDatasetRunName(state.run.id),
    cases,
  }
}
