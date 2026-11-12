import { describe, expect, it } from 'vitest'
import { releasedTextTitle } from './text-title'

describe('releasedTextTitle', () => {
  it('names the work by its designation and the edition by its label', () => {
    expect(releasedTextTitle('OIB-Richtlinie 4', 'Nutzungssicherheit und Barrierefreiheit', 'Ausgabe Mai 2023')).toBe(
      'OIB-Richtlinie 4, Ausgabe Mai 2023',
    )
  })

  it('falls back to the work title when the work has no designation', () => {
    expect(releasedTextTitle(null, 'Begriffsbestimmungen', 'Ausgabe September 2025')).toBe('Begriffsbestimmungen, Ausgabe September 2025')
  })

  it('names the work alone when the edition has no label, and nothing when there is no work', () => {
    expect(releasedTextTitle('OIB-Richtlinie 6', null, '  ')).toBe('OIB-Richtlinie 6')
    expect(releasedTextTitle(null, null, 'Ausgabe Mai 2023')).toBeNull()
  })

  it('flattens control characters and markup out of record text', () => {
    expect(releasedTextTitle('OIB-Richtlinie\n2 <b>', null, 'Ausgabe\tMai 2023')).toBe('OIB-Richtlinie 2 b, Ausgabe Mai 2023')
  })
})
