// @disk-inputs: ../../packages/agent/src/agent/observability/golden_scores.py
/**
 * @vitest-environment node
 *
 * A golden run's scores in Langfuse: every name the run writes is one the
 * Python catalogue declares as the BFF's (`GOLDEN_SCORE_DEFINITIONS`, from
 * which the score configs are provisioned), with the type it writes; and a
 * settled case becomes one score per name, on the trace of its answer, under
 * ids a repeated step upserts.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { GOLDEN_SCORE_NAMES, type GoldenCaseResult } from '@/lib/base-knowledge/wire/golden-case'
import { goldenDatasetItemId, toGoldenScores } from './golden-run-score'

const DECLARED = readFileSync(join(process.cwd(), '..', '..', 'packages', 'agent', 'src', 'agent', 'observability', 'golden_scores.py'), 'utf8')

/** Each declared score: its name, its data type and who writes it (`agent` when the definition names nobody). */
const declared = [...DECLARED.matchAll(/ScoreDefinition\(\s*name="([a-z-]+)",\s*data_type="([A-Z]+)",[\s\S]*?\n {4}\),/g)].map((match) => ({
  name: match[1] as string,
  dataType: match[2] as string,
  writer: /writer="bff"/.test(match[0]) ? 'bff' : 'agent',
}))

const result: GoldenCaseResult = {
  checks: [
    { kind: 'value', id: 'distance', passed: true, decides: true, detail: 'present' },
    { kind: 'citation', id: 'Fire Code', passed: false, decides: true, detail: 'no cited source carries the designation' },
    { kind: 'value', id: 'height', passed: false, decides: false, detail: 'none is in the answer' },
  ],
  scores: { 'golden-case-passed': false, 'golden-expected-values': 0.5, 'golden-must-not-violations': 0, 'claim-citation-resolves': false, 'law-cited-from-web': true, 'golden-seconds': 36.3 },
  unconfirmed: 1,
  confidence: 'high',
  seconds: 36.3,
  costUsd: null,
  traceId: '0af7651916cd43dd8448eb211c80319c',
}

describe('the golden run’s score names', () => {
  it('are each declared in the Python catalogue as the BFF’s', () => {
    expect(declared.length).toBeGreaterThanOrEqual(GOLDEN_SCORE_NAMES.length)
    const written = declared.filter((definition) => definition.writer === 'bff').map((definition) => definition.name)
    expect([...written].sort()).toEqual([...GOLDEN_SCORE_NAMES].sort())
  })

  it('declare the six citation scores, three of them with no writer yet', () => {
    const names = declared.map((definition) => definition.name)
    expect(names).toEqual(expect.arrayContaining(['edition-named', 'citation-role-resolved', 'claim-citation-resolves', 'edition-agrees', 'law-cited-from-web', 'binding-claim-without-records']))
    expect(declared.filter((definition) => definition.writer === 'agent').map((definition) => definition.name).sort()).toEqual(['binding-claim-without-records', 'citation-role-resolved', 'edition-agrees'])
  })
})

describe('toGoldenScores', () => {
  const scores = toGoldenScores({ runId: 'run-1', countryId: 'XA', key: 'xa-stair', traceId: result.traceId as string, result })

  it('writes one score per name on the answer’s trace, typed as the catalogue declares it', () => {
    expect(scores.map((score) => score.name).sort()).toEqual(Object.keys(result.scores).sort())
    for (const score of scores) {
      expect(score.traceId).toBe(result.traceId)
      expect(score.dataType, score.name).toBe(declared.find((definition) => definition.name === score.name)?.dataType)
      expect(score.metadata).toEqual({ golden_run_id: 'run-1', golden_case: 'xa-stair', country_id: 'XA' })
    }
    expect(scores.find((score) => score.name === 'law-cited-from-web')?.value).toBe(1)
    expect(scores.find((score) => score.name === 'golden-expected-values')?.value).toBe(0.5)
  })

  it('names the deciding checks that failed on the verdict, and derives ids a repeated step upserts', () => {
    const verdict = scores.find((score) => score.name === 'golden-case-passed')
    expect(verdict).toMatchObject({ value: 0, comment: 'citation:Fire Code', id: 'golden-case-passed-run-1-xa-stair' })
    expect(new Set(scores.map((score) => score.id)).size).toBe(scores.length)
    expect(goldenDatasetItemId('XA', 'xa-stair')).toBe('golden-case-xa-xa-stair')
  })
})
