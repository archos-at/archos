// @disk-inputs: tests/fixtures/address-register/bev/*.csv
/**
 * @vitest-environment node
 *
 * The pure half of site resolution (ADR-0172) on real BEV rows (the fixture is
 * cut from the register, reference date 2025-10-01): parsing the archive,
 * narrowing the rows a typed line found, the profile it writes, and
 * competence decided by the one evaluator. The SQL half, the importer and the
 * routes' service run against Postgres in `site-resolution.integration.spec.ts`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { rulesetValuesSchema } from '@/lib/base-knowledge/wire/ruleset'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import { bevAttribution, bevEntry, bevLookups, csvRecords, splitCsvLine, type RegisterEntry } from './bev'
import { authorityOf, siteFacts } from './competence'
import { IMPORT_BATCH_SIZE, columnsOf } from './import'
import { houseKeysOf, narrow, outcomeOf, placeKeysOf } from './match'
import { streetKey } from './normalize'
import { parseAddress } from './parse'
import { siteProfileOperations } from './profile'
import { BEV_ADDRESS_REGISTER, federalStateToken, registerFor } from './registers'
import type { RegisterRow } from './store'
import type { RegisterSite } from './wire'

const DIR = join(process.cwd(), 'tests/fixtures/address-register/bev')
const lines = (name: string) => readFileSync(join(DIR, name), 'utf8').split('\n')
const LOOKUPS = bevLookups({
  municipalityRows: csvRecords(lines('GEMEINDE.csv')),
  localityRows: csvRecords(lines('ORTSCHAFT.csv')),
  streetRows: csvRecords(lines('STRASSE.csv')),
})
const ENTRIES: RegisterEntry[] = [...csvRecords(lines('ADRESSE.csv'))].flatMap((row) => bevEntry(row, LOOKUPS) ?? [])
const RELEASE = { id: 'release', register: 'at-bev', referenceDate: '2025-10-01', attribution: bevAttribution('2025-10-01') }
const ROWS: (RegisterRow & { streetKey: string })[] = ENTRIES.map((entry) => ({ release: RELEASE, ...entry }))

/** What the SQL lookup returns for a line: the rows with its exact street key and one of its house keys. */
function lookup(line: string) {
  const parsed = parseAddress(line)
  if (!parsed) throw new Error(`unparsed: ${line}`)
  const keys = houseKeysOf(parsed)
  const found = ROWS.filter((row) => row.streetKey === streetKey(parsed.street) && keys.includes(row.houseKey))
  const narrowed = narrow(parsed, found, BEV_ADDRESS_REGISTER.postcodeShape)
  return outcomeOf(narrowed.rows, narrowed.conflict)
}

describe('the BEV archive', () => {
  it('splits a quoted, semicolon-separated line, with an empty field and a doubled quote', () => {
    expect(splitCsvLine('"5733839";"60101";;"a ""b"""')).toEqual(['5733839', '60101', '', 'a "b"'])
  })

  it('keys every fixture address, with its municipality, locality and delivery place', () => {
    expect(ENTRIES).toHaveLength(20)
    const herrengasse = ENTRIES.find((entry) => entry.addressId === '5734380')
    expect(herrengasse).toMatchObject({
      municipalityCode: '60101',
      municipalityName: 'Graz',
      postcode: '8010',
      streetName: 'Herrengasse',
      houseNumber: '16',
      streetKey: 'herrengasse',
      houseKey: '16',
      crs: 31256,
    })
    expect(herrengasse?.placeKeys).toContain('graz')
    expect(ENTRIES.find((entry) => entry.addressId === '7370068')?.placeKeys).toEqual(expect.arrayContaining(['mittelberg', 'riezlern']))
  })

  it('skips a row it cannot key rather than guess', () => {
    expect(bevEntry({ ADRCD: '1', GKZ: '99999', PLZ: '1010', SKZ: '901940', HNR_ADR_ZUSAMMEN: '1' }, LOOKUPS)).toBeNull()
    expect(bevEntry({ ADRCD: '1', GKZ: '90001', PLZ: '', SKZ: '901940', HNR_ADR_ZUSAMMEN: '1' }, LOOKUPS)).toBeNull()
  })

  it('writes a batch within the bind parameters one Postgres statement takes', () => {
    expect(IMPORT_BATCH_SIZE * Object.keys(columnsOf('release', ENTRIES[0])).length).toBeLessThanOrEqual(65_535)
  })

  it('says the attribution the licence asks for', () => {
    expect(bevAttribution('2025-10-01')).toBe('© Österreichisches Adressregister, Stichtagsdaten vom 01.10.2025')
  })
})

describe('the territory chain of a register address', () => {
  it('names a Gemeinde\'s territory and Land by the Gemeindekennziffer; the chain itself comes from the records', () => {
    expect(BEV_ADDRESS_REGISTER.municipalityTerritory('60101')).toBe('AT:gkz:60101')
    expect(BEV_ADDRESS_REGISTER.stateOf('90001')).toBe('AT-9')
    expect(BEV_ADDRESS_REGISTER.stateOf('00001')).toBeNull()
    expect(federalStateToken('AT-6')).toBe('styria')
  })

  it('hosts a register for Austria only: Germany is E31, not built', () => {
    expect(registerFor('AT')?.id).toBe('at-bev')
    expect(registerFor('DE')).toBeNull()
  })
})

describe('narrowing the rows a line found', () => {
  it('finds exactly one address for a full Austrian line (positive control)', () => {
    const outcome = lookup('Herrengasse 16, 8010 Graz')
    expect(outcome.status).toBe('one')
    expect(outcome.status === 'one' && outcome.row.addressId).toBe('5734380')
  })

  it('finds the same address however the street is written', () => {
    for (const line of ['herrengasse 16 8010 graz', '8010 Graz, Herrengasse 16', 'Herrengasse 16/2/5, 8010 Graz'])
      expect(lookup(line)).toMatchObject({ status: 'one', row: { addressId: '5734380' } })
  })

  it('does not take a postcode that names another address', () => {
    expect(lookup('Herrengasse 16, 8020 Graz')).toEqual({ status: 'none', reason: 'no_register_hit', rows: [] })
  })

  it('answers multi_leaf for a street and number in several Gemeinden, with each as a candidate', () => {
    const outcome = lookup('Hauptplatz 1')
    expect(outcome).toMatchObject({ status: 'none', reason: 'multi_leaf' })
    expect(outcome.status === 'none' && new Set(outcome.rows.map((row) => row.municipalityCode))).toEqual(new Set(['60101', '61108', '62041']))
  })

  it('narrows by place when no postcode is given', () => {
    expect(lookup('Hauptplatz 1, Leoben')).toMatchObject({ status: 'one', row: { municipalityCode: '61108' } })
  })

  it('finds a Kleinwalsertal address typed with the German postcode (E30)', () => {
    expect(lookup('Walserstraße 54, 87567 Riezlern')).toMatchObject({ status: 'one', row: { municipalityCode: '80228', postcode: '6991' } })
  })

  it('refuses a postcode the place contradicts, whichever way round (conflict, never the postcode\'s address)', () => {
    expect(lookup('Herrengasse 16, 8010 Wien')).toMatchObject({ status: 'none', reason: 'conflict' })
    expect(lookup('Herrengasse 16, 1010 Graz')).toMatchObject({ status: 'none', reason: 'conflict' })
    expect(lookup('Herrengasse 16, 8010 Zürich')).toMatchObject({ status: 'none', reason: 'conflict' })
  })

  it('takes a district written after the place', () => {
    expect(lookup('Herrengasse 16, 1010 Wien-Innere Stadt')).toMatchObject({ status: 'one', row: { addressId: '6792486' } })
  })

  it('reads a place only whole, or before a district after a dash, comma or slash; never by a prefix of its key', () => {
    expect(placeKeysOf('Wien-Innere Stadt')).toEqual(['wieninnerestadt', 'wien'])
    const row = (place: string): RegisterRow => ({ ...ROWS[0], placeKeys: [place], postcode: '9999' })
    const placed = (line: string, place: string) => narrow(parseAddress(line)!, [row(place)], BEV_ADDRESS_REGISTER.postcodeShape).rows
    expect(placed('Herrengasse 16, Wiener Neudorf', 'wien')).toEqual([])
    expect(placed('Dorfstraße 3, Steinach am Brenner', 'stein')).toEqual([])
    expect(placed('Herrengasse 16, Aichkirchen', 'aich')).toEqual([])
    expect(placed('Herrengasse 16, Wien/Innere Stadt', 'wien')).toHaveLength(1)
  })

  it('finds nothing for an address the register does not hold', () => {
    expect(lookup('Herrengasse 999, 8010 Graz')).toMatchObject({ status: 'none', reason: 'no_register_hit' })
  })
})

const graz = (authority: RegisterSite['authority']): RegisterSite => ({
  addressId: 'at-bev:5734380',
  label: 'Herrengasse 16, 8010 Graz',
  country: 'AT',
  state: { territoryId: 'AT-6', name: 'Steiermark', federalState: 'styria' },
  municipality: { territoryId: 'AT:gkz:60101', name: 'Graz', code: '60101' },
  locality: 'Graz,01.Bez.:Innere Stadt',
  postcode: '8010',
  chain: ['AT:gkz:60101', 'AT-6', 'AT'],
  register: { id: 'at-bev', referenceDate: '2025-10-01', attribution: bevAttribution('2025-10-01') },
  authority,
})

describe('the profile a resolution writes', () => {
  const now = new Date('2026-11-10T10:00:00Z')
  const NO_SITE = { facts: {}, assumptions: {} }
  const confirmed = (value: string, evidence: unknown[] = []) => ({
    value, confidence: 'confirmed' as const, source: 'user_confirmed' as const, updatedAt: now.toISOString(), evidence: evidence as never,
  })

  it('writes a verified site as confirmed facts with the register as evidence, after clearing the old site', () => {
    const operations = siteProfileOperations({ status: 'verified', typed: 'Herrengasse 16, 8010 Graz', site: graz({ status: 'undetermined', reason: 'no_rule' }) }, 'user_1', now, NO_SITE)
    const removes = operations.filter((operation) => operation.op === 'remove').map((operation) => operation.path)
    expect(removes).toContain('/facts/federal_state')
    expect(removes).toContain('/assumptions/site_address')
    const adds = Object.fromEntries(operations.filter((operation) => operation.op === 'add').map((operation) => [operation.path, (operation.value as { value: string }).value]))
    expect(adds).toEqual({
      '/facts/site_address': 'Herrengasse 16, 8010 Graz',
      '/facts/country': 'at',
      '/facts/federal_state': 'styria',
      '/facts/municipality': 'Graz',
      '/facts/site_territory': 'AT:gkz:60101',
    })
    const evidence = (operations.find((operation) => operation.op === 'add' && operation.path === '/facts/country')?.value as { evidence: unknown[] }).evidence
    expect(evidence).toEqual([{ kind: 'register', addressId: 'at-bev:5734380', label: 'Herrengasse 16, 8010 Graz', referenceDate: '2025-10-01', resolvedAt: now.toISOString() }])
  })

  it('keeps an unverified line as an assumption, never a fact, with the Land its postcode suggests', () => {
    const operations = siteProfileOperations({ status: 'unverified', typed: 'Herrengasse 16, 8010 Graz', reason: 'no_register', statedCountry: null, candidates: [] }, 'user_1', now, NO_SITE)
    const adds = operations.filter((operation) => operation.op === 'add')
    expect(adds.map((operation) => operation.path)).toEqual(['/assumptions/site_address', '/assumptions/federal_state'])
    expect(adds.every((operation) => (operation.value as { status: string }).status === 'unconfirmed')).toBe(true)
  })

  it('never takes away a site a person confirmed when the new line is unverified', () => {
    const personConfirmed = { facts: { country: confirmed('at'), federal_state: confirmed('styria'), site_address: confirmed('Herrengasse 16, 8010 Graz') }, assumptions: {} }
    const operations = siteProfileOperations({ status: 'unverified', typed: 'Herrengasse 999, 8010 Graz', reason: 'no_register_hit', statedCountry: null, candidates: [] }, 'user_1', now, personConfirmed)
    const removed = operations.filter((operation) => operation.op === 'remove' && operation.path.startsWith('/facts/')).map((operation) => operation.path)
    expect(removed).toEqual(['/facts/site_address'])
    // The confirmed Land stands, so no postcode suggestion is laid beside it.
    expect(operations.filter((operation) => operation.op === 'add').map((operation) => operation.path)).toEqual(['/assumptions/site_address'])
  })

  it('removes, with an unverified line, the facts a register derived from the old address', () => {
    const register = { kind: 'register', addressId: 'at-bev:5734380', label: 'Herrengasse 16, 8010 Graz', referenceDate: '2025-10-01', resolvedAt: now.toISOString() }
    const registerPlaced = { facts: { country: confirmed('at', [register]), federal_state: confirmed('styria', [register]), municipality: confirmed('Graz', [register]) }, assumptions: {} }
    const operations = siteProfileOperations({ status: 'unverified', typed: 'Hauptplatz 1, 8700 Leoben', reason: 'no_register', statedCountry: null, candidates: [] }, 'user_1', now, registerPlaced)
    const removed = operations.filter((operation) => operation.op === 'remove' && operation.path.startsWith('/facts/')).map((operation) => operation.path)
    expect(removed).toEqual(['/facts/site_address', '/facts/country', '/facts/federal_state', '/facts/municipality'])
  })

  it('keeps a stated foreign country as stated, unverified (invariant A1)', () => {
    const operations = siteProfileOperations({ status: 'unverified', typed: 'Marienplatz 8, D-80331 München', reason: 'no_register', statedCountry: 'DE', candidates: [] }, 'user_1', now, NO_SITE)
    const adds = Object.fromEntries(operations.filter((operation) => operation.op === 'add').map((operation) => [operation.path, (operation.value as { value: string; status: string })]))
    expect(Object.keys(adds)).toEqual(['/assumptions/site_address', '/assumptions/country'])
    expect(adds['/assumptions/country']).toMatchObject({ value: 'de', status: 'unconfirmed' })
  })
})

const competence = (rows: { municipality: string; authorityId: string }[]): StoredRuleset => ({
  id: 'ruleset:test-styria',
  values: rulesetValuesSchema.parse({
    purpose: 'competence',
    territoryIds: ['AT-6'],
    validFrom: '2020-01-01',
    body: {
      kind: 'table',
      payloadSchema: 'decision_table.v1',
      payload: {
        inputs: [{ key: 'municipality', type: 'code' }],
        output: { type: 'bodies' },
        rows: rows.map((row, index) => ({
          id: `row-${index}`,
          when: { '===': [{ var: 'municipality' }, row.municipality] },
          then: { bodies: [{ authorityId: row.authorityId, role: 'decides' }] },
          provision: { citation: 'synthetic: § 95 Stmk. BauG' },
        })),
        otherwise: { undetermined: true },
        examples: [],
      },
    },
  }),
})

describe('competence for a site', () => {
  const chain = ['AT:gkz:60101', 'AT-6', 'AT']
  const names = new Map([['authority:test-graz', 'Bürgermeister der Stadt Graz (Bau- und Anlagenbehörde)']])

  it('hands the chain to the evaluator as facts, a recorded Bezirk as the district', () => {
    expect(siteFacts(chain)).toEqual({ municipality: 'AT:gkz:60101', state: 'AT-6', country: 'AT' })
    expect(siteFacts(['AT:gkz:61108', 'AT:bezirk:611', 'AT-6', 'AT'])).toEqual({
      municipality: 'AT:gkz:61108', district: 'AT:bezirk:611', state: 'AT-6', country: 'AT',
    })
  })

  it('names the authority a ruleset in force decides for the Gemeinde (positive control)', () => {
    expect(authorityOf([competence([{ municipality: 'AT:gkz:60101', authorityId: 'authority:test-graz' }])], chain, '2026-11-10', names)).toEqual({
      status: 'decided',
      bodies: [{ authorityId: 'authority:test-graz', name: 'Bürgermeister der Stadt Graz (Bau- und Anlagenbehörde)', role: 'decides' }],
      rulesetId: 'ruleset:test-styria',
      territoryId: 'AT-6',
      citation: 'synthetic: § 95 Stmk. BauG',
    })
  })

  it('decides nothing without a ruleset for the chain: no_rule, never a default', () => {
    expect(authorityOf([], chain, '2026-11-10', names)).toEqual({ status: 'undetermined', reason: 'no_rule' })
  })

  it('decides nothing for a Gemeinde the table does not list', () => {
    expect(authorityOf([competence([{ municipality: 'AT:gkz:61108', authorityId: 'authority:test-leoben' }])], chain, '2026-11-10', names)).toEqual({
      status: 'undetermined',
      reason: 'no_row_applies',
    })
  })
})
