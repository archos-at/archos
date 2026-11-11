import { describe, expect, it } from 'vitest'
import { placeKey, postalPlaceOf } from './postal-place'

describe('postalPlaceOf', () => {
  it.each([
    ['Mariahilfer Straße 1, 1060 Wien', 'vienna'],
    ['Linzer Straße 1, 1140 Wien', 'vienna'],
    ['Hauptstraße 3, 1140 Purkersdorf', 'lower_austria'],
    ['Herrengasse 16, 8010 Graz', 'styria'],
    ['Maria-Theresien-Straße 1, A-6020 Innsbruck, Österreich', 'tyrol'],
    ['Neuer Platz 1, 9020 Klagenfurt am Wörthersee', 'carinthia'],
    ['Hauptplatz 1, 4020 Linz', 'upper_austria'],
    ['6767 Warth', 'vorarlberg'],
    ['6767 Steeg', 'tyrol'],
  ])('reads %s as %s', (address, state) => {
    expect(postalPlaceOf(address)?.federalState).toBe(state)
  })

  it.each([
    ['Bahnhofstrasse 1, 8001 Zürich', 'a Swiss code is four digits too'],
    ['Städtle 1, 9490 Vaduz', 'Liechtenstein'],
    ['Marienplatz 1, 80331 München', 'a German code has five digits'],
    ['Hauptstraße 1, 1060 Wien, Schweiz', 'a foreign country named in the line'],
    ['Bahnhofstraße 1, CH-8001 Graz', 'a foreign prefix'],
    ['Hauptstraße 1, 1060', 'no place after the code'],
    ['Hauptstraße 1, 1140', 'a code that serves two Länder, without a place'],
    ['Musterweg 7', 'no code at all'],
    ['', 'nothing typed'],
  ])('places nothing for %s (%s)', (address) => {
    expect(postalPlaceOf(address)).toBeNull()
  })

  it('compares St. and Sankt alike, as the table does', () => {
    expect(placeKey('St. Pölten')).toBe('sankt pölten')
    expect(postalPlaceOf('Rathausplatz 1, 3100 St. Pölten')?.federalState).toBe('lower_austria')
  })
})
