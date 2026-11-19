import { describe, expect, it } from 'vitest'
import { directoryStanding, freshnessOf } from './freshness'

const NOW = new Date('2026-11-06T12:00:00Z')
const check = (checkedAt: string, result: 'current' | 'newer_known' = 'current') => ({
  checkedAt,
  checkedBy: 'user_1',
  result,
  note: null,
})

describe('how fresh an entry’s last check is', () => {
  it('holds a standard for a year and a directive for half of one', () => {
    expect(freshnessOf('technical_standard', check('2026-01-10T00:00:00Z'), NOW).overdue).toBe(false)
    expect(freshnessOf('authority_directive', check('2026-01-10T00:00:00Z'), NOW)).toMatchObject({
      intervalDays: 180,
      overdue: true,
    })
  })

  it('is overdue when never checked, or when the check found a newer edition', () => {
    expect(freshnessOf('technical_standard', null, NOW)).toMatchObject({ overdue: true, dueAt: null })
    expect(freshnessOf('technical_standard', check('2026-11-01T00:00:00Z', 'newer_known'), NOW).overdue).toBe(true)
  })

  it('names when the next check is due', () => {
    expect(freshnessOf('commentary', check('2026-01-01T00:00:00Z'), NOW).dueAt).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('the Stand the platform’s editions give a work it lists', () => {
  const TODAY = '2026-11-19'
  const listed = [
    { label: '2017-04-15', issuedOn: null, inForceFrom: '2017-04-15', inForceTo: null },
    { label: '2023-02-01', issuedOn: null, inForceFrom: '2023-02-01', inForceTo: null },
    { label: '2027-01-01', issuedOn: null, inForceFrom: '2027-01-01', inForceTo: null },
  ]
  const inForce = { editionLabel: '2023-02-01', startsOn: '2023-02-01' }

  it('is current when the office holds the edition in force today, and newer when it holds only an older one', () => {
    expect(directoryStanding([{ editionLabel: '2023-02-01', startsOn: '2023-02-01' }], listed, TODAY)).toEqual({ inForce, held: true })
    expect(directoryStanding([{ editionLabel: '2017-04-15', startsOn: '2017-04-15' }], listed, TODAY)).toEqual({ inForce, held: false })
    expect(
      directoryStanding([{ editionLabel: '2017-04-15', startsOn: '2017-04-15' }, { editionLabel: '2023', startsOn: '2023-02-01' }], listed, TODAY),
    ).toEqual({ inForce, held: true })
  })

  it('knows an undated copy only by the label the platform gives the edition in force', () => {
    expect(directoryStanding([{ editionLabel: ' 2023-02-01', startsOn: null }], listed, TODAY)).toEqual({ inForce, held: true })
    expect(directoryStanding([{ editionLabel: 'Ausgabe 2017', startsOn: null }], listed, TODAY)).toBeNull()
  })

  it('says nothing when the platform dates none of its editions, or none is in force today', () => {
    const own = [{ editionLabel: '2017-04-15', startsOn: '2017-04-15' }]
    expect(directoryStanding(own, listed.map((edition) => ({ ...edition, inForceFrom: null })), TODAY)).toBeNull()
    expect(directoryStanding(own, [{ ...listed[1], inForceTo: '2024-01-01' }], TODAY)).toBeNull()
    expect(directoryStanding(own, [], TODAY)).toBeNull()
  })

  it('counts an edition the platform dates only by its issue as out since that day', () => {
    const issued = listed.map((edition) => ({ ...edition, issuedOn: edition.inForceFrom, inForceFrom: null }))
    expect(directoryStanding([{ editionLabel: '2017-04-15', startsOn: '2017-04-15' }], issued, TODAY)).toEqual({ inForce, held: false })
  })
})
