// @disk-inputs: ../../configs/knowledge-packs/at.json, ../../configs/knowledge-packs/eu.json
/**
 * @vitest-environment node
 *
 * The Austria and EU packs (ADR-0168) say what the OIB says binds where. Each
 * pack is a proposal in the records format: it parses as one, passes the
 * validation kit as a change request for its country (the EU pack first,
 * because Austria names the union as a dated parent), and resolves, Land by
 * Land, to the editions the OIB's in-force table lists (Stand Oktober 2026).
 * The expectations below are written from that table, not from the pack, except
 * where the authentic gazette on RIS says otherwise: RIS governs (Burgenland's
 * RL 6 2025, Salzburg's RL 6 März 2015, and the Salzburg and Niederösterreich days).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_PROPOSED_RECORDS, proposeRecordsBodySchema, proposedRecordSchema, type ProposedRecord } from '../platform/wire'
import { recordIdOf } from '../platform/records'
import { validateProposal, type KnownRecord } from '../platform/validate'
import { graphFromProposals } from './from-proposals'
import { resolveChain } from './resolve'

interface PackFile {
  countryId: string
  title: string
  records: unknown[]
}

const read = (name: string): PackFile => JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', name), 'utf8'))
const recordsOf = (pack: PackFile): ProposedRecord[] => proposedRecordSchema.array().parse(pack.records)

const at = read('at.json')
const eu = read('eu.json')
const atRecords = recordsOf(at)
const euRecords = recordsOf(eu)
const graph = graphFromProposals([...euRecords, ...atRecords])

/** The OIB's table, corrected by RIS: the binding edition of RL 1–5 and of RL 6 per Land on 2026-11-10. */
const BINDING_ON_2026_11_10: Record<string, { rl1to5: string | null; rl6: string | null }> = {
  'AT-1': { rl1to5: '2019', rl6: '2025' }, // LGBl. 75/2026; the OIB table still shows '-'
  'AT-2': { rl1to5: '2023', rl6: '2023' },
  'AT-3': { rl1to5: '2023', rl6: '2023' },
  'AT-4': { rl1to5: '2023', rl6: '2019' },
  'AT-5': { rl1to5: '2023', rl6: '2015' }, // LGBl. 83/2026 § 1; the OIB table lists no adoption
  'AT-6': { rl1to5: '2019', rl6: '2019' },
  'AT-7': { rl1to5: '2023', rl6: '2025' },
  'AT-8': { rl1to5: '2019', rl6: '2019' },
  'AT-9': { rl1to5: '2023', rl6: '2025' },
}

const RL_1_TO_5 = ['1', '2', '2-1', '2-2', '2-3', '3', '4', '5']

function bindingEditions(leaf: string, date: string, rl: string): string[] {
  return resolveChain(graph, leaf, date)
    .uses.filter((use) => use.role === 'binding' && use.workId === `work:oib-rl-${rl}`)
    .map((use) => (use.editionId ?? '').replace(`edition:oib-rl-${rl}-`, ''))
}

describe('the Austria and EU packs', () => {
  /** KC-6 asks every platform record for a capture of its change request; a pack file holds none (ADR-0170). */
  const structural = (problems: readonly { code: string }[]) => problems.filter((problem) => problem.code !== 'KC-6')
  const published = new Map<string, KnownRecord>(euRecords.map((record) => [recordIdOf(record), { type: record.type, countryId: 'EU' }]))

  it('are proposals the platform accepts but for their captures: one change request each, valid against what it names', () => {
    expect(at.countryId).toBe('AT')
    expect(eu.countryId).toBe('EU')
    // A change request takes its records in batches of MAX_PROPOSED_RECORDS (records-propose upserts into it).
    for (let start = 0; start < atRecords.length; start += MAX_PROPOSED_RECORDS)
      expect(() => proposeRecordsBodySchema.parse({ records: at.records.slice(start, start + MAX_PROPOSED_RECORDS) })).not.toThrow()
    expect(structural(validateProposal(euRecords, 'EU', new Map(), new Map()))).toEqual([])
    // A text's file is in the base corpus before its record is written (ADR-0165): the corpus answers for each, as the api tier does.
    const held = new Map(atRecords.filter((record) => record.type === 'manifestation' && record.corpusFile).map((record) => [recordIdOf(record), []]))
    expect(held.size).toBeGreaterThan(0)
    expect(structural(validateProposal(atRecords, 'AT', published, new Map(), [], held))).toEqual([])
    // Unasked, each of those texts is a problem at its corpusFile, and nothing else is.
    const unasked = validateProposal(atRecords, 'AT', published, new Map()).filter((problem) => problem.code !== 'KC-6')
    expect(unasked.map((problem) => `${problem.code} ${problem.pointer}`)).toEqual([...held].map(() => 'KC-1 /corpusFile'))
  })

  it('cannot be published from the file alone: every record still needs a captured, quoted source', () => {
    const uncited = (records: readonly ProposedRecord[], countryId: string, known: ReadonlyMap<string, KnownRecord>) =>
      new Set(validateProposal(records, countryId, known, new Map()).filter((problem) => problem.code === 'KC-6').map((problem) => problem.index))
    expect(uncited(euRecords, 'EU', new Map()).size).toBe(euRecords.length)
    expect(uncited(atRecords, 'AT', published).size).toBe(atRecords.length)
  })

  it('needs the EU pack first: Austria names the union as a dated parent', () => {
    expect(validateProposal(atRecords, 'AT', new Map(), new Map()).map((problem) => problem.detail)).toContain(
      'names territory EU, which is not imported; import it first.',
    )
  })

  it.each(Object.entries(BINDING_ON_2026_11_10))('defect 7: %s binds the editions the OIB lists for it', (leaf, expected) => {
    for (const rl of RL_1_TO_5) expect(bindingEditions(leaf, '2026-11-10', rl), `RL ${rl}`).toEqual(expected.rl1to5 ? [expected.rl1to5] : [])
    expect(bindingEditions(leaf, '2026-11-10', '6'), 'RL 6').toEqual(expected.rl6 ? [expected.rl6] : [])
  })

  it('resolves every Land within the bound, so no cited edition loses its role', () => {
    for (const leaf of Object.keys(BINDING_ON_2026_11_10)) expect(resolveChain(graph, leaf, '2026-11-10').truncated, leaf).toBe(false)
  })

  it('binds the 2019 edition in Wien before 2024-02-23 and the 2023 edition from that day', () => {
    expect(bindingEditions('AT-9', '2024-02-22', '2')).toEqual(['2019'])
    expect(bindingEditions('AT-9', '2024-02-23', '2')).toEqual(['2023'])
  })

  it('takes the in-force day from RIS where the OIB table differs: Salzburg, Niederösterreich, Burgenland', () => {
    expect(bindingEditions('AT-5', '2026-08-31', '2')).toEqual(['2019'])
    expect(bindingEditions('AT-5', '2026-09-01', '2')).toEqual(['2023'])
    expect(bindingEditions('AT-3', '2025-03-19', '4')).toEqual(['2019'])
    expect(bindingEditions('AT-3', '2025-03-20', '4')).toEqual(['2023'])
    expect(bindingEditions('AT-1', '2026-11-04', '6')).toEqual(['2019'])
    expect(bindingEditions('AT-1', '2026-11-05', '6')).toEqual(['2025'])
  })

  it('tirol-rl6-2025: Tirol binds RL 6 2025 from 2026-07-16 without Pkt 2.2 and 2.3.1', () => {
    expect(bindingEditions('AT-7', '2026-07-15', '6')).toEqual(['2019'])
    const [rl6] = resolveChain(graph, 'AT-7', '2026-11-10').uses.filter((use) => use.role === 'binding' && use.workId === 'work:oib-rl-6')
    expect(rl6.displaced.map((displaced) => displaced.anchor)).toEqual(['pkt_2.2', 'pkt_2.3.1'])
  })

  it('cpr-at-project: the CPR binds an Austrian site through its EU membership; the EPBD is information', () => {
    const uses = resolveChain(graph, 'AT-9', '2026-11-10').uses
    expect(uses.find((use) => use.workId === 'work:eu-cpr')?.role).toBe('binding')
    expect(uses.find((use) => use.workId === 'work:eu-epbd')?.role).toBe('information')
  })

  it('maps every OIB text of the base corpus to its edition: the id map retrieval reads', () => {
    const files = [...graph.editions.values()].flatMap((edition) => edition.corpusFiles.map((file) => [file, edition.id]))
    expect(Object.fromEntries(files)).toEqual({
      'oib-rl_1_ausgabe_mai_2023.pdf': 'edition:oib-rl-1-2023',
      'oib-rl_2_ausgabe_mai_2023.pdf': 'edition:oib-rl-2-2023',
      'oib-rl_2.1_ausgabe_mai_2023.pdf': 'edition:oib-rl-2-1-2023',
      'oib-richtlinie_2.2_ausgabe_mai_2023.pdf': 'edition:oib-rl-2-2-2023',
      'oib-rl_2.3_ausgabe_mai_2023.pdf': 'edition:oib-rl-2-3-2023',
      'oib-rl_3_ausgabe_mai_2023.pdf': 'edition:oib-rl-3-2023',
      'oib-rl_4_ausgabe_mai_2023.pdf': 'edition:oib-rl-4-2023',
      'oib-rl_5_ausgabe_mai_2023.pdf': 'edition:oib-rl-5-2023',
      'oib-rl_6_ausgabe_mai_2023.pdf': 'edition:oib-rl-6-2023',
      // The other binding editions, under the names oib.or.at publishes (agent/common/oib_file_names.py).
      'richtlinie_1_12.04.19_0.pdf': 'edition:oib-rl-1-2019',
      'oib-rl-2-brandschutz-2019.pdf': 'edition:oib-rl-2-2019',
      'oib-rl-2.1-brandschutz-bei-betriebsbauten-2019.pdf': 'edition:oib-rl-2-1-2019',
      'oib-rl-2.2-brandschutz-bei-garagen-ueberdachten-stellplaetzen-und-parkdecks-2019.pdf': 'edition:oib-rl-2-2-2019',
      'oib-rl-2.3-brandschutz-bei-gebaeuden-mit-einem-fluchtniveau-von-mehr-als-22-m-2019.pdf': 'edition:oib-rl-2-3-2019',
      'oib-rl-3-hygiene-gesundheit-und-umweltschutz-2019.pdf': 'edition:oib-rl-3-2019',
      'oib-rl-4-nutzungssicherheit-und-barrierefreiheit-2019.pdf': 'edition:oib-rl-4-2019',
      'oib-rl-5-schallschutz-2019.pdf': 'edition:oib-rl-5-2019',
      'oib-rl-6-energieeinsparung-und-waermeschutz-2019.pdf': 'edition:oib-rl-6-2019',
      'oib-rl_6_september_2025.pdf': 'edition:oib-rl-6-2025',
      'oib-rl-6-energieeinsparung-und-waermeschutz-2015.pdf': 'edition:oib-rl-6-2015',
    })
  })

  it('cites a source for every record, so a reviewer checks each claim against it', () => {
    for (const record of [...atRecords, ...euRecords]) expect(record.citations.length, recordIdOf(record)).toBeGreaterThan(0)
  })
})
