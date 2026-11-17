import 'server-only'
/**
 * A golden run in Langfuse (ADR-0165 amendment, ADR-0089): each scored case is
 * an item of the dataset `golden-cases` (the question and what a right answer
 * says), linked to the trace of the turn that answered it under the dataset
 * run `golden-<run id>`, with the case's scores on that trace. So a run is
 * compared with the one before it in Langfuse's own dataset view, case by
 * case, beside seconds and cost.
 *
 * Every score name is declared in `agent.observability.golden_scores`
 * (`GOLDEN_SCORE_DEFINITIONS`, spread into `SCORE_DEFINITIONS`);
 * `golden-run-score.spec.ts` holds the names written here to that list. Ids are
 * derived from the run and the case, so a step that settles a case twice
 * upserts. Best-effort: never throws into the run, and without a trace there
 * is no score, because a score on a guessed trace attaches to nothing.
 */

import type { GoldenCase, GoldenCaseResult } from '@/lib/base-knowledge/wire/golden-case'
import { langfuseApiConfig } from './config'
import { clientFor, upsertScore } from './feedback-score'

/** The dataset a golden case is an item of (`GOLDEN_CASES_DATASET` in `agent.observability.golden_scores`). The run creates it: Langfuse upserts a dataset by name. */
export const GOLDEN_CASES_DATASET = 'golden-cases'

type ScoreRequest = Parameters<typeof upsertScore>[2]

/** The dataset run of a golden run; null where Langfuse is not configured. */
export function goldenDatasetRunName(runId: string): string | null {
  return langfuseApiConfig() ? `golden-${runId}` : null
}

/** A case's dataset item id: stable per country and key, so every run of the case is one row's history. */
export const goldenDatasetItemId = (countryId: string, key: string) => `golden-case-${countryId.toLowerCase()}-${key}`

/** The scores of one settled case as Langfuse takes them. Pure. */
export function toGoldenScores(input: { runId: string; countryId: string; key: string; traceId: string; result: GoldenCaseResult }): ScoreRequest[] {
  const failed = input.result.checks.filter((check) => !check.passed && check.decides).map((check) => `${check.kind}:${check.id}`)
  return Object.entries(input.result.scores).map(([name, value]) => ({
    id: `${name}-${input.runId}-${input.key}`,
    traceId: input.traceId,
    name,
    dataType: typeof value === 'boolean' ? ('BOOLEAN' as const) : ('NUMERIC' as const),
    value: typeof value === 'boolean' ? (value ? 1 : 0) : value,
    ...(name === 'golden-case-passed' && failed.length > 0 ? { comment: failed.join(', ').slice(0, 500) } : {}),
    metadata: { golden_run_id: input.runId, golden_case: input.key, country_id: input.countryId },
  }))
}

/** Record a settled case: its dataset item, its run item and its scores. Resolves when done and never rejects. */
export async function recordGoldenScores(input: { runId: string; countryId: string; golden: GoldenCase; result: GoldenCaseResult }): Promise<void> {
  const config = langfuseApiConfig()
  const traceId = input.result.traceId
  if (!config || !traceId) return
  const key = input.golden.key
  try {
    const api = clientFor(config).api
    const datasetItemId = goldenDatasetItemId(input.countryId, key)
    await api.datasets.create({ name: GOLDEN_CASES_DATASET, description: 'Golden cases of every country: platform records of type golden_case, written by golden runs.' })
    await api.datasetItems.create({
      datasetName: GOLDEN_CASES_DATASET,
      id: datasetItemId,
      input: { question: input.golden.question, language: input.golden.language, context: input.golden.context },
      expectedOutput: { expected: input.golden.expected, mustNot: input.golden.mustNot },
      metadata: { country_id: input.countryId, tags: input.golden.tags },
    })
    await api.datasetRunItems.create({
      runName: `golden-${input.runId}`,
      datasetItemId,
      traceId,
      metadata: { country_id: input.countryId, golden_run_id: input.runId },
    })
    await Promise.all(toGoldenScores({ runId: input.runId, countryId: input.countryId, key, traceId, result: input.result }).map((score) => upsertScore(config, String(score.id), score)))
  } catch (error) {
    console.warn(`[Langfuse] golden run ${input.runId} could not record case ${key} (non-fatal):`, error)
  }
}
