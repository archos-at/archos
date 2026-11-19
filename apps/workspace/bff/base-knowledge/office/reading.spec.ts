import { describe, expect, it } from 'vitest'
import { defaultLicence, proposeFromReading, readDesignation } from './reading'
import { AT_SUBDIVISIONS } from '@/lib/project-intake/at-setup.fixtures'

describe('what the reading proposes for a base-knowledge document', () => {
  it('reads an ÖNORM with its edition from the masthead, read like any file while the office is not asked about licences', () => {
    const values = proposeFromReading({
      fileName: 'OENORM_B_1600_2017-04-01.pdf',
      title: 'ÖNORM B 1600:2017-04-01 Barrierefreies Bauen — Planungsgrundlagen',
    }, AT_SUBDIVISIONS)
    expect(values).toMatchObject({
      kind: 'technical_standard',
      designation: 'ÖNORM B 1600:2017',
      editionLabel: '2017-04-01',
      issuedOn: '2017-04-01',
      territoryIds: [],
      issuer: 'Austrian Standards',
      addressees: [],
      licenceClass: 'public_open',
    })
  })

  it('reads an MA 37 Weisung as a directive addressed to Vienna, public by default', () => {
    const values = proposeFromReading({ fileName: 'MA37_Weisung_Dachgeschossausbau_2021-03-15.pdf' }, AT_SUBDIVISIONS)
    expect(values).toMatchObject({
      kind: 'authority_directive',
      addressees: [{ name: 'MA 37', territoryId: 'AT-9' }],
      territoryIds: ['AT-9'],
      licenceClass: 'public_open',
      editionLabel: '2021-03-15',
    })
  })

  it('reads a commentary as a commentary, applying nowhere by itself', () => {
    const values = proposeFromReading({ fileName: 'Moritz_BauO_Wien_Kommentar_2019.pdf', federalState: 'vienna' }, AT_SUBDIVISIONS)
    expect(values).toMatchObject({ kind: 'commentary', licenceClass: 'public_open', territoryIds: [], editionLabel: '2019' })
  })

  it('proposes a bought standard or commentary as licensed only when the licence step is asked', () => {
    expect(defaultLicence('technical_standard', true)).toBe('licensed')
    expect(defaultLicence('commentary', true)).toBe('licensed')
    expect(defaultLicence('authority_directive', true)).toBe('public_open')
    expect(defaultLicence('technical_standard', false)).toBe('public_open')
  })

  it('keeps a document it cannot place a proposal, never a failure', () => {
    const values = proposeFromReading({ fileName: 'scan_0001.pdf' }, AT_SUBDIVISIONS)
    expect(values.title).toBe('scan_0001')
    expect(values.editionLabel).toBe('unbekannt')
  })

  it('spells the designation one way however the file name wrote the umlaut', () => {
    expect(readDesignation('ONORM B 1600')?.designation).toBe('ÖNORM B 1600')
    expect(readDesignation('OENORM EN 1991-1-1:2011')?.designation).toBe('ÖNORM EN 1991-1-1:2011')
    expect(readDesignation('DIN 4109-1:2018-01')?.designation).toBe('DIN 4109-1:2018')
  })
})
