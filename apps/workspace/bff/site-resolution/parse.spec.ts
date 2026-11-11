import { describe, expect, it } from 'vitest'
import { houseKey, placeKey, streetKey } from './normalize'
import { parseAddress } from './parse'

describe('keys', () => {
  it('folds case, diacritics, ß, separators and the Straße abbreviation into one street key', () => {
    const keys = ['Mariahilfer Straße', 'mariahilfer strasse', 'Mariahilfer Str.', 'Mariahilferstr', 'MARIAHILFER-STRASSE'].map(streetKey)
    expect(new Set(keys)).toEqual(new Set(['mariahilferstrasse']))
    expect(streetKey('Josef Stanislaus Albach-Gasse')).toBe(streetKey('Josef Stanislaus Albachgasse'))
  })

  it('keeps distinct names distinct: nothing is fuzzy', () => {
    expect(streetKey('Herrengasse')).not.toBe(streetKey('Herrgasse'))
    expect(streetKey('Strobler Weg')).toBe('stroblerweg')
  })

  it('reads St. as Sankt in a place', () => {
    expect(placeKey('St. Pölten')).toBe(placeKey('Sankt Pölten'))
    expect(placeKey('St.Veit an der Glan')).toBe(placeKey('Sankt Veit an der Glan'))
  })

  it('writes a house number as the register does', () => {
    expect(houseKey('12 A')).toBe('12a')
    expect(houseKey('3 - 5')).toBe('3-5')
    expect(houseKey('16')).toBe('16')
  })
})

describe('parseAddress', () => {
  it('reads the usual Austrian line', () => {
    expect(parseAddress('Herrengasse 16, 8010 Graz')).toEqual({
      street: 'Herrengasse', houseNumber: '16', doorless: null, postcode: '8010', place: 'Graz', statedCountry: null,
    })
  })

  it('reads a line without commas and one with the place first', () => {
    expect(parseAddress('Herrengasse 16 8010 Graz')).toMatchObject({ street: 'Herrengasse', houseNumber: '16', postcode: '8010', place: 'Graz' })
    expect(parseAddress('8010 Graz, Herrengasse 16')).toMatchObject({ street: 'Herrengasse', houseNumber: '16', postcode: '8010', place: 'Graz' })
  })

  it('keeps a staircase and door apart from the house number', () => {
    expect(parseAddress('Mariahilfer Straße 12/3/4, 1060 Wien')).toMatchObject({ houseNumber: '12/3/4', doorless: '12' })
  })

  it('takes a stated country as stated, from a prefix or a trailing name', () => {
    expect(parseAddress('Marienplatz 8, D-80331 München')?.statedCountry).toBe('DE')
    expect(parseAddress('Marienplatz 8, 80331 München, Deutschland')?.statedCountry).toBe('DE')
    expect(parseAddress('Stephansplatz 1, A-1010 Wien')?.statedCountry).toBe('AT')
  })

  it('reads no country from a five-digit postcode alone (E30, Kleinwalsertal)', () => {
    expect(parseAddress('Walserstraße 54, 87567 Riezlern')).toMatchObject({ postcode: '87567', place: 'Riezlern', statedCountry: null })
  })

  it('keeps a street whose name holds a number', () => {
    expect(parseAddress('Straße des 1. Mai 3, 4600 Wels')).toMatchObject({ street: 'Straße des 1. Mai', houseNumber: '3' })
  })

  it('reads a lot number (GNR) as the house number, as the register writes it', () => {
    expect(parseAddress('Dallein GNR 310/4, 3753 Geras')).toMatchObject({ street: 'Dallein', houseNumber: 'GNR 310/4', doorless: null })
    expect(parseAddress('Kellergasse Stiefern GNR .87, 3562 Schönberg am Kamp')).toMatchObject({ street: 'Kellergasse Stiefern', houseNumber: 'GNR .87' })
    expect(houseKey('GNR .87')).toBe('gnr.87')
  })

  it('answers null for a line with nothing to look up', () => {
    expect(parseAddress('Graz')).toBeNull()
    expect(parseAddress('8010 Graz')).toBeNull()
    expect(parseAddress('')).toBeNull()
  })

  it('takes a place with no postcode', () => {
    expect(parseAddress('Hauptplatz 1, Leoben')).toMatchObject({ street: 'Hauptplatz', houseNumber: '1', postcode: null, place: 'Leoben' })
  })
})
