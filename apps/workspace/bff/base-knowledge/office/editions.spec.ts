import { describe, expect, it } from 'vitest'
import { designationStem, editionStanding, type SeriesMember } from './editions'

const member = (id: string, designation: string | null, issuedOn: string | null, rest: Partial<SeriesMember> = {}): SeriesMember => ({
  id,
  confirmed: true,
  createdAt: new Date('2026-01-01'),
  values: { kind: 'technical_standard', designation, title: 'Barrierefreies Bauen', issuedOn, inForceFrom: null, inForceTo: null },
  ...rest,
})

describe('editions of one standard', () => {
  it('takes the designation without its edition as the standard', () => {
    expect(designationStem('ÖNORM B 1600:2017-04-01')).toBe('ÖNORM B 1600')
  })

  it('keeps the newest started edition in force and marks the earlier superseded by it', () => {
    const standing = editionStanding([member('old', 'ÖNORM B 1600:2017', '2017-04-01'), member('new', 'ÖNORM B 1600:2023', '2023-02-01')], '2026-11-11')
    expect(standing.get('new')).toMatchObject({ inForce: true, supersededBy: null, editions: 2 })
    expect(standing.get('old')).toMatchObject({ inForce: false, supersededBy: 'new' })
  })

  it('leaves a proposal out, so an unconfirmed upload never displaces the edition in force', () => {
    const standing = editionStanding([member('old', 'ÖNORM B 1600:2017', '2017-04-01'), member('new', 'ÖNORM B 1600:2023', '2023-02-01', { confirmed: false })], '2026-11-11')
    expect(standing.get('old')?.inForce).toBe(true)
    expect(standing.has('new')).toBe(false)
  })

  it('keeps standards with other designations apart', () => {
    const standing = editionStanding([member('a', 'ÖNORM B 1600:2017', '2017-04-01'), member('b', 'ÖNORM B 1300:2018', '2018-11-01')], '2026-11-11')
    expect(standing.get('a')?.inForce).toBe(true)
    expect(standing.get('b')?.inForce).toBe(true)
  })
})
