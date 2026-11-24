import { describe, expect, it } from 'vitest'
import { matchesEveryWord } from './every-word'

describe('matchesEveryWord', () => {
  it('needs every word of the query somewhere in the fields, ignoring case and accents', () => {
    expect(matchesEveryWord(['Brandschutzkonzept_v3.pdf', 'Fluchtweg prüfen'], 'PRUFEN brandschutz')).toBe(true)
    expect(matchesEveryWord(['Brandschutzkonzept_v3.pdf', 'Fluchtweg prüfen'], 'prüfen statik')).toBe(false)
  })

  it('lets an empty query through and skips missing fields', () => {
    expect(matchesEveryWord([null, undefined], '   ')).toBe(true)
    expect(matchesEveryWord([null, 'Anna Berger'], 'berger')).toBe(true)
    expect(matchesEveryWord([null], 'berger')).toBe(false)
  })
})
