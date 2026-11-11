// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json, ../../configs/knowledge-packs/at-scopes.json
/**
 * @vitest-environment node
 *
 * Austria's scopes for OIB-RL 2.1, 2.2 and 2.3 (ADR-0178): a change request of
 * their own after the Austria pack, each edition again with `appliesWhen`. They
 * are what the OIB texts say, read from each guideline's title and the defined
 * term its Punkt 1 refers to; the rows' quotes were checked against the
 * published PDFs when the file was written. Here: they pass the kit against the
 * pack (their examples included, KC-5), they change nothing of an edition but
 * its scope and citations, and in Vienna the chain names each for the buildings
 * it is written for.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BuildingInputs } from '../rulesets/applicability'
import { recordIdOf } from '../platform/records'
import { validateProposal, type KnownRecord } from '../platform/validate'
import { proposeRecordsBodySchema, proposedRecordSchema, type ProposedRecord } from '../platform/wire'
import { graphFromProposals } from './from-proposals'
import { resolveChain } from './resolve'

interface PackFile {
  countryId: string
  records: unknown[]
}

const read = (name: string): PackFile => JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', name), 'utf8'))
const recordsOf = (pack: PackFile): ProposedRecord[] => proposedRecordSchema.array().parse(pack.records)

const scopes = read('at-scopes.json')
const scopeRecords = recordsOf(scopes)
const atRecords = recordsOf(read('at.json'))
const euRecords = recordsOf(read('eu.json'))
const byId = new Map(scopeRecords.map((record) => [recordIdOf(record), record]))
const graph = graphFromProposals([...euRecords, ...atRecords.map((record) => byId.get(recordIdOf(record)) ?? record)])

const SCOPED = ['oib-rl-2-1-2019', 'oib-rl-2-1-2023', 'oib-rl-2-2-2019', 'oib-rl-2-2-2023', 'oib-rl-2-3-2019', 'oib-rl-2-3-2023']

/** What the chain says of OIB-RL 2.1, 2.2 and 2.3 in Vienna today for one building. */
function inVienna(inputs: BuildingInputs['inputs']) {
  const uses = resolveChain(graph, 'AT-9', '2026-11-10', { buildings: [{ buildingId: 'bldg1', inputs }] }).uses
  return Object.fromEntries(
    ['2-1', '2-2', '2-3'].map((rl) => {
      const use = uses.find((candidate) => candidate.workId === `work:oib-rl-${rl}` && candidate.role === 'binding')
      return [rl, use ? { verdict: use.applicability?.verdict, open: use.applicability?.open } : 'not named']
    }),
  )
}

describe('Austria’s scopes for OIB-RL 2.1, 2.2 and 2.3', () => {
  it('are one change request for AT the kit accepts against the published pack, examples run, but for their captures', () => {
    expect(scopes.countryId).toBe('AT')
    expect(() => proposeRecordsBodySchema.parse({ records: scopes.records })).not.toThrow()
    const published = new Map<string, KnownRecord>(
      [...euRecords.map((record) => [recordIdOf(record), { type: record.type, countryId: 'EU' }] as const), ...atRecords.map((record) => [recordIdOf(record), { type: record.type, countryId: 'AT' }] as const)],
    )
    expect(validateProposal(scopeRecords, 'AT', published, new Map()).filter((problem) => problem.code !== 'KC-6')).toEqual([])
  })

  it('give each 2019 and 2023 edition of the three a scope, and change nothing else of it but add its citations', () => {
    expect(scopeRecords.map(recordIdOf).sort()).toEqual(SCOPED.map((key) => `edition:${key}`))
    for (const record of scopeRecords) {
      const inPack = atRecords.find((candidate) => recordIdOf(candidate) === recordIdOf(record))
      if (record.type !== 'edition' || inPack?.type !== 'edition') throw new Error(`${recordIdOf(record)} is no edition of the pack`)
      const { appliesWhen, citations, ...rest } = record
      const { appliesWhen: before, citations: cited, ...packRest } = inPack
      expect(before).toBeNull()
      expect(rest).toEqual(packRest)
      expect(citations.slice(0, cited.length)).toEqual(cited)
      expect(appliesWhen?.rows.every((row) => row.provision?.citation.includes('Begriffsbestimmungen'))).toBe(true)
    }
  })

  it('in Vienna, names 2.2 for a block of flats over a garage and neither 2.1 nor 2.3', () => {
    expect(inVienna({ uses: ['residential', 'garage'], escape_level_m: 9 })).toEqual({
      '2-1': 'not named',
      '2-2': { verdict: 'applies', open: [] },
      '2-3': 'not named',
    })
  })

  it('names 2.1 for a production hall, and 2.3 once the escape level passes 22 m', () => {
    expect(inVienna({ uses: ['production'], escape_level_m: 8 })).toMatchObject({ '2-1': { verdict: 'applies' }, '2-3': 'not named' })
    expect(inVienna({ uses: ['office'], escape_level_m: 30 })).toMatchObject({ '2-1': 'not named', '2-3': { verdict: 'applies' } })
  })

  it('asks for the escape level while it is open, and leaves a farm building’s 2.1 to a person', () => {
    expect(inVienna({ uses: ['office'] })).toMatchObject({ '2-3': { verdict: 'check', open: ['escape_level_m'] } })
    expect(inVienna({ uses: ['agriculture'], escape_level_m: 6 })).toMatchObject({ '2-1': { verdict: 'check', open: [] } })
  })
})
