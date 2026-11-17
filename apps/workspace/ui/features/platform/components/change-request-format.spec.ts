import { describe, expect, it } from 'vitest'
import { byReadingOrder, recordName, showValue, territoryName, type Wording } from './change-request-format'

const WORDING: Wording = {
  locale: 'de',
  kindWord: (kind) => (kind === 'technical_standard' ? 'Technische Norm' : null),
  functionWord: (code) => (code === 'building_permit' ? 'Baubewilligung' : null),
  licenceWord: () => null,
}

describe('a claim as a reviewer reads it', () => {
  it('names a territory, with its code beside it', () => {
    expect(territoryName('AT-9', 'de')).toBe('Wien')
    expect(territoryName('AT', 'de')).toBe('Österreich')
    expect(territoryName('AT:gkz:60101', 'de')).toBeNull()
    expect(showValue('competenceTerritoryIds', ['AT-9'], WORDING)).toEqual({ kind: 'list', items: [{ text: 'Wien', code: 'AT-9' }] })
    expect(showValue('seatTerritoryId', 'AT-9', WORDING)).toEqual({ kind: 'text', text: 'Wien', code: 'AT-9' })
    expect(showValue('parents', [{ id: 'AT' }, { id: 'EU', validFrom: '1995-01-01', validTo: null }], WORDING)).toEqual({
      kind: 'list',
      items: [expect.objectContaining({ code: 'AT' }), expect.objectContaining({ code: 'EU', text: expect.stringMatching(/, 1995-01-01 –$/) })],
    })
  })

  it('words kinds and functions, and reads a designation as itself', () => {
    expect(showValue('kind', 'technical_standard', WORDING)).toEqual({ kind: 'text', text: 'Technische Norm' })
    expect(showValue('functionCodes', ['building_permit'], WORDING)).toEqual({ kind: 'list', items: [{ text: 'Baubewilligung' }] })
    expect(showValue('identifiers', { designation: 'ÖNORM B 5371' }, WORDING)).toEqual({ kind: 'text', text: 'ÖNORM B 5371' })
    expect(showValue('workId', 'work:oenorm-b-5371', WORDING)).toEqual({ kind: 'text', text: 'oenorm-b-5371' })
  })

  it('shows nothing as nothing, never as null or []', () => {
    expect(showValue('issuer', null, WORDING)).toEqual({ kind: 'empty' })
    expect(showValue('territoryIds', [], WORDING)).toEqual({ kind: 'empty' })
  })

  it('titles a record by its name and puts its fields in reading order', () => {
    expect(recordName([{ path: 'name', value: 'MA 37 Baupolizei' }], 'authority:at-wien-ma37')).toBe('MA 37 Baupolizei')
    expect(recordName([], 'edition:oenorm-b-5371-2021')).toBe('oenorm-b-5371-2021')
    expect(byReadingOrder([{ path: 'seatTerritoryId' }, { path: 'name' }, { path: 'zzz' }]).map((claim) => claim.path)).toEqual([
      'name',
      'seatTerritoryId',
      'zzz',
    ])
  })
})
