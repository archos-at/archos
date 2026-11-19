import { describe, expect, it } from 'vitest'
import { defaultLicence, proposeFromReading, readDesignation, recognizeNorm } from './reading'
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

describe('which uploaded file is a norm', () => {
  const norm = (fileName: string, title?: string) => recognizeNorm({ fileName, title })

  it('recognises standards by their designation, however the file name spells it', () => {
    expect(norm('OENORM_B_8110-3_2020-03-15_de.pdf')).toEqual({ norm: true, designation: 'ÖNORM B 8110-3' })
    expect(norm('EN_1991-1-1.pdf')).toEqual({ norm: true, designation: 'EN 1991-1-1' })
    expect(norm('DIN_4109-1_2018-01.pdf')).toMatchObject({ norm: true })
    expect(norm('B2320_2017_08_01_de.pdf')).toEqual({ norm: true, designation: 'ÖNORM B 2320' })
    expect(norm('B_1991-1-1_Nationaler_Anhang.pdf')).toEqual({ norm: true, designation: 'ÖNORM B 1991-1-1' })
  })

  it('recognises authority directives, guidelines and commentaries on the law', () => {
    expect(norm('MA37_Weisung_Dachgeschoss_2024-09.pdf')).toEqual({ norm: true, designation: null })
    expect(norm('RVS_Garagen.pdf')).toEqual({ norm: true, designation: null })
    expect(norm('Leitfaden_Parkhaeuser_Garagen.pdf')).toEqual({ norm: true, designation: null })
    expect(norm('Moritz_BauO_Wien_Kommentar_2019.pdf')).toEqual({ norm: true, designation: null })
  })

  it('leaves ordinary project files alone, even when their names look like a designation', () => {
    expect(norm('Haus_A_2024_Einreichung.pdf')).toEqual({ norm: false, platformHeld: false })
    expect(norm('Bauteil_B_2023-05-12_Fotos.pdf')).toEqual({ norm: false, platformHeld: false })
    expect(norm('B_2023-05-12_Fotos.pdf')).toEqual({ norm: false, platformHeld: false })
    expect(norm('Bescheid_MA37_2024-05.pdf')).toEqual({ norm: false, platformHeld: false })
    expect(norm('Kommentar_Bauherr_Planbesprechung.pdf')).toEqual({ norm: false, platformHeld: false })
    expect(norm('Plankopf_Vorlage_A0.pdf')).toEqual({ norm: false, platformHeld: false })
  })

  it('says an OIB guideline is already held by the platform rather than taking it as the office’s', () => {
    expect(norm('OIB-Richtlinie_2_2023.pdf')).toEqual({ norm: false, platformHeld: true })
    expect(norm('OIB-RL_2_2023.pdf')).toEqual({ norm: false, platformHeld: true })
  })
})
