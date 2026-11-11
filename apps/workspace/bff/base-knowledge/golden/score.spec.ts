// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json, ../../configs/knowledge-packs/at-golden-cases.json, ../../tests/fixtures/golden/scoring_parity.json
/**
 * @vitest-environment node
 *
 * The yardstick, held three ways. The scorer's own rules; Austria's golden
 * cases as a proposal that parses, passes the kit beside the Austria pack and
 * names, for each case, the edition the pack's relations make binding at its
 * site on its day; and the recorded before-baseline, where the old scorecard
 * wrote "high" and this finds the fault. `UPDATE_FIXTURES=1` rewrites the
 * verdicts the Python mirror is held to (`tests/test_golden_eval.py`).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { graphFromProposals } from '../chain/from-proposals'
import { resolveChain } from '../chain/resolve'
import { recordIdOf } from '../platform/records'
import { validateProposal, type KnownRecord } from '../platform/validate'
import { proposedRecordSchema, type ProposedRecord } from '../platform/wire'
import type { GoldenAnswer, GoldenCase } from '../wire/golden-case'
import { holdsPhrase, scoreGoldenCase } from './score'

const ROOT = join(process.cwd(), '..', '..')
const pack = (name: string): ProposedRecord[] =>
  proposedRecordSchema.array().parse(JSON.parse(readFileSync(join(ROOT, 'configs', 'knowledge-packs', name), 'utf8')).records)
const PARITY = join(ROOT, 'tests', 'fixtures', 'golden', 'scoring_parity.json')

type GoldenRecord = Extract<ProposedRecord, { type: 'golden_case' }>
const lawRecords = [...pack('eu.json'), ...pack('at.json')]
const goldenRecords = pack('at-golden-cases.json') as GoldenRecord[]
const TODAY = '2026-11-11'

const base: GoldenCase = {
  key: 'xa-stair',
  question: 'How long may the escape route be?',
  language: 'en',
  context: { territoryId: 'XA-1', facts: {}, referenceDate: null, note: null },
  expected: {
    values: [{ label: 'distance', anyOf: ['40 m'], grounding: 'text' }],
    edition: { editionKey: 'xa-code-2023', anyOf: ['edition 2023'], role: 'binding', grounding: 'records' },
    citations: [{ designation: 'Fire Code', alsoKnownAs: ['FC'], locus: 'clause 5.1', grounding: 'text' }],
  },
  mustNot: [
    { kind: 'source', id: 'web-copy', sourceKinds: ['web'], naming: [] },
    { kind: 'phrase', id: 'confident-with-gap', in: 'confidence_reason', anyOf: ['open'], whenConfidence: ['high'], whenRecords: 'any' },
    { kind: 'phrase', id: 'binding-before-release', in: 'answer', anyOf: ['is binding'], whenConfidence: [], whenRecords: 'unreleased' },
  ],
  tags: [],
}
const good: GoldenAnswer = {
  text: 'At most 40 m (Fire Code, clause 5.1, edition 2023).',
  confidence: { level: 'high', reason: 'The clause was read.' },
  sources: [{ name: 'Fire Code, edition 2023', kind: 'building_law' }],
  recordsReleased: true,
}
const failed = (golden: GoldenCase, answer: GoldenAnswer) =>
  scoreGoldenCase(golden, answer)
    .checks.filter((check) => !check.passed)
    .map((check) => `${check.kind}:${check.id}`)

describe('holdsPhrase', () => {
  it('finds a phrase as its own words, whatever the case and the spaces', () => {
    expect(holdsPhrase('höchstens 40 m Gehweglänge', '40 m')).toBe(true)
    expect(holdsPhrase('Ausgabe MAI 2023', 'Mai 2023')).toBe(true)
    expect(holdsPhrase('nach § 50 Abs. 1', '§ 50')).toBe(true)
  })

  it('does not find it inside a longer number or word', () => {
    expect(holdsPhrase('140 m', '40 m')).toBe(false)
    expect(holdsPhrase('40 mm', '40 m')).toBe(false)
    expect(holdsPhrase('§ 500', '§ 50')).toBe(false)
    expect(holdsPhrase('unoffen', 'offen')).toBe(false)
  })
})

describe('scoreGoldenCase', () => {
  it('passes an answer that states the value, names the edition and cites the clause', () => {
    const scored = scoreGoldenCase(base, good)
    expect(scored.passed).toBe(true)
    expect(scored.scores).toEqual({
      'golden-case-passed': true,
      'golden-must-not-violations': 0,
      'golden-expected-values': 1,
      'edition-named': true,
      'claim-citation-resolves': true,
      'law-cited-from-web': false,
    })
  })

  it('fails a missing value, an unnamed edition and a citation without its locus, each by name', () => {
    const answer = { ...good, text: 'It depends on the stair.', sources: [{ name: 'Fire Code', kind: 'building_law' as const }] }
    expect(failed(base, answer)).toEqual(['value:distance', 'edition:xa-code-2023', 'citation:Fire Code'])
    expect(scoreGoldenCase(base, answer).scores['golden-expected-values']).toBe(0)
  })

  it('takes the edition and the locus from the cited source as well as from the prose', () => {
    const answer = { ...good, text: 'At most 40 m [1].', sources: [{ name: 'FC, edition 2023', kind: 'building_law' as const, clause: 'clause 5.1' }] }
    expect(scoreGoldenCase(base, answer).passed).toBe(true)
  })

  it('fails high confidence whose reason names an open point, and not the same reason at medium', () => {
    const reason = 'The value is read; the use class is open.'
    expect(failed(base, { ...good, confidence: { level: 'high', reason } })).toEqual(['must_not:confident-with-gap'])
    expect(failed(base, { ...good, confidence: { level: 'medium', reason } })).toEqual([])
  })

  it('fails a cited web source, and says the law was cited from the web', () => {
    const scored = scoreGoldenCase(base, { ...good, sources: [...good.sources, { name: 'A law portal', kind: 'web', url: 'https://law.example/fc' }] })
    expect(scored.checks.find((check) => check.id === 'web-copy')).toMatchObject({ passed: false, detail: 'cites "A law portal" (web)' })
    expect(scored.scores['law-cited-from-web']).toBe(true)
    expect(scored.scores['golden-must-not-violations']).toBe(1)
  })

  it('holds a rule for unreleased records only while the records are unreleased', () => {
    const answer = { ...good, text: `${good.text} It is binding.` }
    expect(failed(base, answer)).toEqual([])
    expect(failed(base, { ...answer, recordsReleased: false })).toEqual(['must_not:binding-before-release'])
  })

  it('scores an unconfirmed expectation and never lets it decide the case', () => {
    const golden: GoldenCase = { ...base, expected: { ...base.expected, values: [{ label: 'distance', anyOf: ['35 m'], grounding: 'unconfirmed' }] } }
    const scored = scoreGoldenCase(golden, good)
    expect(scored.passed).toBe(true)
    expect(scored.unconfirmed).toBe(1)
    expect(scored.scores['golden-expected-values']).toBe(0)
  })
})

describe('Austria’s golden cases', () => {
  it('are the 20 scorecard questions and the 8 acceptance scenarios, each under its own key', () => {
    expect(goldenRecords.map((record) => record.type)).toEqual(Array(28).fill('golden_case'))
    expect(new Set(goldenRecords.map((record) => record.key)).size).toBe(28)
    expect(goldenRecords.filter((record) => record.tags.includes('scorecard'))).toHaveLength(20)
    expect(goldenRecords.filter((record) => record.tags.includes('dev-acceptance'))).toHaveLength(8)
  })

  it('pass the kit beside the Austria pack, but for the captures an operator adds (KC-6)', () => {
    const known = new Map<string, KnownRecord>(lawRecords.map((record) => [recordIdOf(record), { type: record.type, countryId: record.type === 'territory' && record.id === 'EU' ? 'EU' : 'AT' }]))
    const problems = validateProposal(goldenRecords, 'AT', known, new Map())
    expect(problems.filter((problem) => problem.code !== 'KC-6')).toEqual([])
  })

  it('expect, where grounded in the records, the edition the pack makes binding at the site on the day', () => {
    const graph = graphFromProposals(lawRecords)
    const grounded = goldenRecords.filter((record) => record.expected.edition?.grounding === 'records')
    expect(grounded.length).toBeGreaterThanOrEqual(10)
    for (const record of grounded) {
      const edition = record.expected.edition!
      const leaf = record.context.territoryId
      expect(leaf, record.key).not.toBeNull()
      const binding = resolveChain(graph, leaf!, record.context.referenceDate ?? TODAY)
        .uses.filter((use) => use.role === 'binding')
        .map((use) => use.editionId)
      expect(binding, record.key).toContain(`edition:${edition.editionKey}`)
      // The phrase an answer must write is the edition's own label.
      const label = lawRecords.find((law) => law.type === 'edition' && law.key === edition.editionKey)
      expect(edition.anyOf, record.key).toContain(label?.type === 'edition' ? label.label : '')
    }
  })
})

interface ParityFile {
  $comment: string
  answers: { baseline: string; case: string; seconds: number; answer: GoldenAnswer; expect: { passed: boolean; failed: string[]; scores: Record<string, number | boolean>; unconfirmed: number } | null }[]
}

describe('the recorded before-baseline', () => {
  const parity = JSON.parse(readFileSync(PARITY, 'utf8')) as ParityFile
  const goldenOf = (key: string): GoldenCase => {
    const record = goldenRecords.find((candidate) => candidate.key === key)
    if (!record) throw new Error(`no golden case ${key}`)
    return record
  }
  const verdicts = parity.answers.map((entry) => {
    const scored = scoreGoldenCase(goldenOf(entry.case), entry.answer)
    const failedChecks = scored.checks.filter((check) => !check.passed).map((check) => `${check.kind}:${check.id}`)
    return { ...entry, expect: { passed: scored.passed, failed: failedChecks, scores: scored.scores, unconfirmed: scored.unconfirmed } }
  })

  it('scores as the committed verdicts say, the ones the Python mirror is held to', () => {
    const generated = `${JSON.stringify({ ...parity, answers: verdicts }, null, 2)}\n`
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(PARITY, generated, 'utf8')
    expect(readFileSync(PARITY, 'utf8'), 'The scorer or a case changed. Re-run with UPDATE_FIXTURES=1, read the diff, and commit it.').toBe(generated)
  })

  it.each(['B1', 'B9', 'B10', 'B11'])('%s was recorded as high confidence and fails here: its reason names an open point', (baseline) => {
    const verdict = verdicts.find((entry) => entry.baseline === baseline)
    expect(verdict?.answer.confidence?.level).toBe('high')
    expect(verdict?.expect.passed).toBe(false)
    expect(verdict?.expect.failed).toContain('must_not:confident-despite-open-point')
  })

  it('B5, high confidence on a closed reason and cited from the source, keeps every must-not', () => {
    const verdict = verdicts.find((entry) => entry.baseline === 'B5')
    expect(verdict?.expect.scores['golden-must-not-violations']).toBe(0)
    expect(verdict?.expect.scores['law-cited-from-web']).toBe(false)
    expect(verdict?.expect.scores['claim-citation-resolves']).toBe(true)
  })

  it('B14 took its law from web pages, which the scorecard counted as three sources', () => {
    const verdict = verdicts.find((entry) => entry.baseline === 'B14')
    expect(verdict?.expect.failed).toContain('must_not:law-from-web')
    expect(verdict?.expect.scores['law-cited-from-web']).toBe(true)
  })
})
