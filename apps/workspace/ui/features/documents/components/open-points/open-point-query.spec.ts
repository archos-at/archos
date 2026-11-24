import { describe, expect, it } from 'vitest'
import { matchesOpenPoint } from './open-point-query'

const point = { body: 'Fluchtweg im 2. OG prüfen', documentName: 'Brandschutzkonzept_v3.pdf', assigneeName: 'Anna Berger' }

describe('matchesOpenPoint', () => {
  it('finds a point by its text, its document’s name or its assignee, every word, ignoring case and accents', () => {
    expect(matchesOpenPoint(point, 'fluchtweg')).toBe(true)
    expect(matchesOpenPoint(point, 'brandschutzkonzept')).toBe(true)
    expect(matchesOpenPoint(point, 'berger')).toBe(true)
    expect(matchesOpenPoint(point, 'PRUFEN anna')).toBe(true)
    expect(matchesOpenPoint(point, 'statik')).toBe(false)
  })

  it('finds nothing by an assignee the point does not have', () => {
    expect(matchesOpenPoint({ ...point, assigneeName: null }, 'berger')).toBe(false)
  })
})
