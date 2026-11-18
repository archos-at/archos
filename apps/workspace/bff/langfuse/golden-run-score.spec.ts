/**
 * @vitest-environment node
 *
 * A golden run's scores in Langfuse: every name the run writes is one the
 * Python catalogue declares as the BFF's (`GOLDEN_SCORE_DEFINITIONS`, from
 * which the score configs are provisioned), with the type it writes; and a
 * settled case becomes one score per name, on the trace of its answer, under
 * ids a repeated step upserts.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { GOLDEN_SCORE_NAMES, type GoldenCaseResult } from '@/lib/base-knowledge/wire/golden-case'
import { goldenDatasetItemId, toGoldenScores } from './golden-run-score'

const ROOT = join(process.cwd(), '..', '..')

type Declared = { name: string; dataType: string; writer: string }

const CATALOGUE_DUMP = `
import json
from agent.observability.golden_scores import GOLDEN_SCORE_DEFINITIONS
from agent.observability.langfuse_scores import SCORE_DEFINITIONS

def row(definition):
    return {"name": definition.name, "dataType": definition.data_type, "writer": definition.writer}

print(json.dumps({
    "golden": [row(d) for d in GOLDEN_SCORE_DEFINITIONS],
    "runtime": [row(d) for d in SCORE_DEFINITIONS],
}))
`

function declaredByPython(): { golden: Declared[]; runtime: Declared[] } {
  const child = spawnSync('python3', ['-c', CATALOGUE_DUMP], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: join(ROOT, 'packages', 'agent', 'src'), PYTHONDONTWRITEBYTECODE: '1' },
  })
  if (child.status !== 0) throw new Error(`the Python catalogue did not import: ${child.stderr}`)
  return JSON.parse(child.stdout)
}

const { golden, runtime } = declaredByPython()

const result: GoldenCaseResult = {
  checks: [
    { kind: 'value', id: 'distance', passed: true, decides: true, detail: 'present' },
    { kind: 'citation', id: 'Fire Code', passed: false, decides: true, detail: 'no cited source carries the designation' },
    { kind: 'value', id: 'height', passed: false, decides: false, detail: 'none is in the answer' },
  ],
  scores: { 'golden-case-passed': false, 'golden-expected-values': 0.5, 'golden-must-not-violations': 0, 'claim-citation-resolves': false, 'golden-seconds': 36.3 },
  unconfirmed: 1,
  confidence: 'high',
  seconds: 36.3,
  costUsd: null,
  traceId: '0af7651916cd43dd8448eb211c80319c',
}

const CITATION_SCORES = ['claim-citation-resolves', 'edition-agrees', 'edition-named', 'citation-role-resolved', 'law-cited-from-web', 'binding-claim-without-records']

describe('the golden run’s score names', () => {
  it('are each declared in the Python catalogue as the BFF’s', () => {
    expect(golden.length).toBeGreaterThanOrEqual(GOLDEN_SCORE_NAMES.length)
    const written = golden.filter((definition) => definition.writer === 'bff').map((definition) => definition.name)
    expect([...written].sort()).toEqual([...GOLDEN_SCORE_NAMES].sort())
  })

  it('declare the six citation scores once each: two here (one with no writer yet), four where the agent writes them', () => {
    const names = golden.map((definition) => definition.name)
    expect(names).toEqual(expect.arrayContaining(['claim-citation-resolves', 'edition-agrees']))
    expect(golden.filter((definition) => definition.writer === 'agent').map((definition) => definition.name)).toEqual(['edition-agrees'])
    for (const name of CITATION_SCORES) {
      expect(runtime.filter((definition) => definition.name === name), name).toHaveLength(1)
    }
    for (const name of ['edition-named', 'citation-role-resolved', 'law-cited-from-web', 'binding-claim-without-records']) {
      expect(names, name).not.toContain(name)
      expect(runtime.find((definition) => definition.name === name)?.writer, name).toBe('agent')
    }
  })
})

describe('toGoldenScores', () => {
  const scores = toGoldenScores({ runId: 'run-1', countryId: 'XA', key: 'xa-stair', traceId: result.traceId as string, result })

  it('writes one score per name on the answer’s trace, typed as the catalogue declares it', () => {
    expect(scores.map((score) => score.name).sort()).toEqual(Object.keys(result.scores).sort())
    for (const score of scores) {
      expect(score.traceId).toBe(result.traceId)
      expect(score.dataType, score.name).toBe(golden.find((definition) => definition.name === score.name)?.dataType)
      expect(score.metadata).toEqual({ golden_run_id: 'run-1', golden_case: 'xa-stair', country_id: 'XA' })
    }
    expect(scores.find((score) => score.name === 'claim-citation-resolves')?.value).toBe(0)
    expect(scores.find((score) => score.name === 'golden-expected-values')?.value).toBe(0.5)
  })

  it('names the deciding checks that failed on the verdict, and derives ids a repeated step upserts', () => {
    const verdict = scores.find((score) => score.name === 'golden-case-passed')
    expect(verdict).toMatchObject({ value: 0, comment: 'citation:Fire Code', id: 'golden-case-passed-run-1-xa-stair' })
    expect(new Set(scores.map((score) => score.id)).size).toBe(scores.length)
    expect(goldenDatasetItemId('XA', 'xa-stair')).toBe('golden-case-xa-xa-stair')
  })
})
