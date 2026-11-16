/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { cardHighlightSpecs, matchToFilter } from './card-highlights'

describe('matchToFilter', () => {
  it('respells the card grammar as the query grammar', () => {
    expect(
      matchToFilter({
        ifc_types: ['IfcWall'],
        storeys: ['Erdgeschoss'],
        name_contains: 'AW',
        material: 'Beton',
      })
    ).toEqual({
      ifcTypes: ['IfcWall'],
      storeys: ['Erdgeschoss'],
      nameContains: 'AW',
      material: 'Beton',
    })
  })

  it('carries a property predicate, which is the half a client filter could not do', () => {
    expect(
      matchToFilter({
        ifc_types: ['IfcWall'],
        properties: [{ set: 'Pset_WallCommon', name: 'IsExternal', operator: 'eq', value: true }],
      })
    ).toEqual({
      ifcTypes: ['IfcWall'],
      properties: [{ name: 'IsExternal', set: 'Pset_WallCommon', operator: 'eq', value: true }],
    })
  })

  it('reads either spelling of a key', () => {
    expect(matchToFilter({ ifcTypes: ['IfcWall'], nameContains: 'AW' })).toEqual({
      ifcTypes: ['IfcWall'],
      nameContains: 'AW',
    })
  })

  it('carries a classification filter, which the query grammar supports', () => {
    expect(matchToFilter({ classification: 'B.1.2' })).toEqual({ classification: 'B.1.2' })
  })

  it('trims what it forwards, not only what it tests', () => {
    expect(matchToFilter({ name_contains: '  AW  ' })).toEqual({ nameContains: 'AW' })
    expect(matchToFilter({ ifc_types: [' IfcWall ', '  '] })).toEqual({ ifcTypes: ['IfcWall'] })
  })

  it('drops an invented enum VALUE, not just an invented key', () => {
    expect(matchToFilter({ properties: [{ name: 'FireRating', operator: 'like', source: 'blob' }] })).toEqual({
      properties: [{ name: 'FireRating' }],
    })
  })

  it('drops a key the endpoint does not know rather than losing the query', () => {
    expect(matchToFilter({ ifc_types: ['IfcWall'], colour: 'red' })).toEqual({ ifcTypes: ['IfcWall'] })
  })

  it('refuses a filter with no criterion at all', () => {
    expect(matchToFilter({})).toBeNull()
    expect(matchToFilter({ ifc_types: [] })).toBeNull()
    expect(matchToFilter({ name_contains: '   ' })).toBeNull()
    expect(matchToFilter(null)).toBeNull()
    expect(matchToFilter('IfcWall')).toBeNull()
  })

  it('refuses a property predicate with no property name', () => {
    expect(matchToFilter({ properties: [{ operator: 'exists' }] })).toBeNull()
  })

  it('keeps a predicate that legitimately has no value', () => {
    expect(matchToFilter({ properties: [{ name: 'FireRating', operator: 'missing' }] })).toEqual({
      properties: [{ name: 'FireRating', operator: 'missing' }],
    })
  })
})

describe('cardHighlightSpecs', () => {
  it('passes an id list straight through', () => {
    expect(cardHighlightSpecs([{ global_ids: ['0Grid1'], label: 'T-14', status: 'fail' }])).toEqual([
      { globalIds: ['0Grid1'], label: 'T-14', status: 'fail' },
    ])
  })

  it('turns a match into a filter spec', () => {
    expect(
      cardHighlightSpecs([{ match: { ifc_types: ['IfcWall'] }, label: 'Wände', status: 'info' }])
    ).toEqual([{ match: { ifcTypes: ['IfcWall'] }, label: 'Wände', status: 'info' }])
  })

  it('defaults an unrecognised status to neutral rather than to a verdict', () => {
    const [spec] = cardHighlightSpecs([{ global_ids: ['0Grid1'], label: 'x', status: 'kaputt' }])
    expect(spec.status).toBe('info')
  })

  it('drops a group that can never colour anything', () => {
    expect(cardHighlightSpecs([{ label: 'Wände', status: 'info' }])).toEqual([])
    expect(cardHighlightSpecs([{ global_ids: [], match: {}, label: 'Wände', status: 'info' }])).toEqual([])
  })

  it('drops a group with no label, and keeps the rest', () => {
    expect(
      cardHighlightSpecs([
        { global_ids: ['0Grid1'], status: 'fail' },
        { global_ids: ['0Grid2'], label: 'keep', status: 'pass' },
      ])
    ).toEqual([{ globalIds: ['0Grid2'], label: 'keep', status: 'pass' }])
  })

  it('prefers the id list when a malformed card carries both', () => {
    expect(
      cardHighlightSpecs([
        { global_ids: ['0Grid1'], match: { ifc_types: ['IfcWall'] }, label: 'x', status: 'info' },
      ])
    ).toEqual([{ globalIds: ['0Grid1'], label: 'x', status: 'info' }])
  })
})
