import type { PdfLine } from '../_fixtures/sample-pdf'
import { SEARCH_HIT } from './fixtures'

const SEARCH_HIT_SECTIONS = [
  'Allgemeines',
  'Grundlagen',
  'Gebäudebeschreibung',
  'Brandabschnitte',
  'Tragwerk',
  'Fluchtwege',
  'Stiegenhäuser',
  'Rauchableitung',
  'Löschwasser',
  'Feuerwehrzufahrt',
  'Brandmeldeanlage',
  'Sicherheitsbeleuchtung',
]

export const searchHitPages = (): PdfLine[][] =>
  Array.from({ length: SEARCH_HIT.pageCount ?? 24 }, (_, index) => {
    const page = index + 1
    const head: PdfLine[] = [[`Brandschutzkonzept Wohnhaus Seestadt J7 · Seite ${page}`, 9, false], ['', 11, false]]
    if (page === 7) {
      return [
        ...head,
        ['5. Fluchtwege', 14, true],
        ['', 11, false],
        ['5.1 Fluchtweglängen', 12, true],
        ['', 11, false],
        ['Jede Wohnung hat einen Fluchtweg über das Stiegenhaus. Die Fluchtweglänge', 11, false],
        ['beträgt max. 40 m bis zum nächsten gesicherten Stiegenhaus (GK 4, OIB-RL 2,', 11, false],
        ['Pkt. 5.1.1). Gemessen wird in der Lauflinie ab der Wohnungseingangstür.', 11, false],
        ['', 11, false],
        ['Stiege 2 erreicht 42,10 m; die Abweichung ist in Abschnitt 5.3 begründet.', 11, false],
      ]
    }
    const section = SEARCH_HIT_SECTIONS[Math.floor(index / 2) % SEARCH_HIT_SECTIONS.length]!
    return [
      ...head,
      [`${Math.floor(index / 2) + 1}. ${section}`, 14, true],
      ['', 11, false],
      ['Die Angaben dieses Abschnitts beziehen sich auf die Einreichplanung', 11, false],
      ['vom 14.10.2026 und die Pläne EP-01 bis EP-06.', 11, false],
    ]
  })

export const FIRE_SAFETY_PAGES: readonly (readonly PdfLine[])[] = [
  [
    ['Brandschutzkonzept Wohnbau Nord', 22, true],
    ['Gebäudeklasse 4 · OIB-Richtlinie 2 (2023)', 11, false],
    ['', 11, false],
    ['1. Fluchtwege', 14, true],
    ['', 11, false],
    ['Je Nutzungseinheit stehen zwei voneinander unabhängige Fluchtwege', 11, false],
    ['zur Verfügung: der erste über den notwendigen Flur in das nördliche', 11, false],
    ['Sicherheitstreppenhaus, der zweite über die anleiterbaren Fenster', 11, false],
    ['an der Ostfassade.', 11, false],
    ['', 11, false],
    ['Die maximale Gehweglänge im notwendigen Flur beträgt 34 m und', 11, false],
    ['liegt damit unter dem Grenzwert von 40 m.', 11, false],
    ['', 11, false],
    ['2. Brandabschnitte', 14, true],
    ['', 11, false],
    ['Brandabschnitte sind mit Trennwänden REI 90 ausgeführt; die', 11, false],
    ['Wohnungstrennwände erreichen REI 60.', 11, false],
  ],
  [
    ['3. Rauchableitung', 14, true],
    ['', 11, false],
    ['Die Rauchableitung erfolgt über die Rauch- und Wärmeabzugsanlage', 11, false],
    ['im Treppenhaus mit einer aerodynamisch wirksamen Öffnungsfläche', 11, false],
    ['von 1,0 m².', 11, false],
    ['', 11, false],
    ['4. Löschwasser und Feuerwehr', 14, true],
    ['', 11, false],
    ['Löschwasserversorgung, Aufstellflächen und die Kennzeichnung der', 11, false],
    ['Rettungswege sind im Lageplan Blatt 3 dokumentiert.', 11, false],
  ],
]

export const ROOM_PROGRAMME_PAGES: readonly (readonly PdfLine[])[] = [
  [
    ['Raumprogramm Wohnbau Nord', 22, true],
    ['Flächen je Nutzungseinheit und Geschoss', 11, false],
    ['', 11, false],
    ['Regelgeschoss', 14, true],
    ['', 11, false],
    ['Top 1   Wohnen/Essen 38,4 m²   Zimmer 12,1 m²   Zimmer 10,8 m²', 11, false],
    ['Top 2   Wohnen/Essen 34,9 m²   Zimmer 11,6 m²', 11, false],
    ['Top 3   Wohnen/Essen 38,4 m²   Zimmer 12,1 m²   Zimmer 10,8 m²', 11, false],
    ['Top 4   Wohnen/Essen 29,7 m²', 11, false],
    ['', 11, false],
    ['Erschließung über den Laubengang an der Hofseite.', 11, false],
  ],
]
