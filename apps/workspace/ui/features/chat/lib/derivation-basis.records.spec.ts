import { describe, expect, test } from 'vitest'
import { translatorFor } from '@/i18n/namespace'
import { chatCopy } from '@/i18n/namespaces/chat'
import stairs from '@/test-utils/stored-answers/graz-stairs.json'
import uValue from '@/test-utils/stored-answers/wien-u-value.json'
import { buildCitationModel } from './citations'
import {
  adoptingAct,
  basisLines,
  cardName,
  documentLocation,
  documentLocationDetail,
  addressOf,
  pageRanges,
} from './derivation-basis'
import { documentShortName } from './document-names'
import { mapServerMessageToChatMessage } from './server-message-mapper'

/** The cards of a stored answer, read back the way a reload reads it. */
const cardsOf = (stored: typeof stairs | typeof uValue) =>
  buildCitationModel({ citations: mapServerMessageToChatMessage(stored.answer)?.citations ?? [] })

const t = translatorFor(chatCopy, 'de')
const FILE_NAME = /\.pdf\b|text-[0-9a-f]{6,}/

describe('the Herleitung names a cited edition by its records, never by its file', () => {
  test('the last card says the edition, the act it is binding through and since when, then the passage', () => {
    const law = basisLines(t, cardsOf(stairs)).law.map((line) => line.text)
    expect(law[0]).toBe('OIB-Richtlinie 4, Ausgabe April 2019 (verbindlich über StBTV 2020 seit 01.09.2020, laut Plattformdaten, noch nie an der Quelle geprüft), Tabelle 3 · S. 4, 10')
    // Law read live keeps its own title and has no route: it is law in its own territory.
    expect(law[1]).toBe('Steiermärkische Bautechnikverordnung 2020 – StBTV 2020, § 1')
    for (const text of law) expect(text).not.toMatch(FILE_NAME)
  })

  test('an act whose provision is a gazette number is said with its designation in front', () => {
    const [line] = basisLines(t, cardsOf(uValue)).law
    expect(line.numbers).toEqual([1, 2])
    expect(line.text.startsWith('OIB-Richtlinie 6, Ausgabe 2025 (verbindlich über WBTV, LGBl. 26/2026 seit 15.07.2026, laut Plattformdaten, noch nie an der Quelle geprüft)')).toBe(true)
    expect(line.text).not.toMatch(FILE_NAME)
  })

  test('the card in the fan reads its name off the same records', () => {
    for (const doc of [...cardsOf(stairs), ...cardsOf(uValue)]) {
      expect(cardName(doc)).not.toMatch(FILE_NAME)
      expect(documentShortName(doc.fileName ?? doc.title, doc.title)).not.toMatch(FILE_NAME)
    }
  })
})

describe('a route the platform has checked', () => {
  test('is stated without the unchecked note', () => {
    const [doc] = cardsOf(stairs)
    const checked = { ...doc, line: { ...doc.line, role_labels: [] } }
    expect(basisLines(t, [checked]).law[0].text).toContain('(verbindlich über StBTV 2020 seit 01.09.2020), ')
  })
})

describe('adoptingAct', () => {
  test('nothing without a binding role through an act', () => {
    expect(adoptingAct({})).toBeUndefined()
    expect(adoptingAct({ line: { route: { work_id: 'work:a', provision: 'A 2020' } } })).toBeUndefined()
    expect(adoptingAct({ line: { role: 'binding' } })).toBeUndefined()
  })

  test('the provision alone when it already says the designation, else both', () => {
    const route = (provision?: string, designation?: string) => ({
      line: { role: 'binding', route: { work_id: 'work:a', provision, designation } },
    })
    expect(adoptingAct(route('StBTV 2020', 'StBTV'))).toBe('StBTV 2020')
    expect(adoptingAct(route('LGBl. 26/2026', 'WBTV'))).toBe('WBTV, LGBl. 26/2026')
    expect(adoptingAct(route(undefined, 'WBTV'))).toBe('WBTV')
  })
})

describe('addressOf', () => {
  test('a clause a reader can write down is its address', () => {
    for (const clause of ['3.2.1', '2.3.1a', 'A.1', '§ 1', '§ 43 Abs. 2', '§ 36 Abs. 1 Z 9', 'Art. 15a', 'Artikel 3', 'Tabelle 3', 'Tab. 2b', 'Anhang A', 'Anh. B', 'Anlage 1', 'Ziffer 3', 'Z 9', 'Abs. 2', 'Absatz 2', 'Pkt. 4.2', 'pkt. 4.2', 'lit. a', 'Kapitel 3', 'Abschnitt 2.3']) {
      expect(addressOf(clause), clause).toBe(clause)
    }
    expect(addressOf('3.2.1.')).toBe('3.2.1.')
    expect(addressOf('3.2.1 Allgemeines')).toBe('3.2.1')
  })

  test('a heading, a bare word, a year, a cover number and the Vorbemerkungen are none', () => {
    for (const clause of ['Punktförmige Wärmebrücken', 'Tabellenverzeichnis', 'Abbildungsverzeichnis', 'Begriffsbestimmungen', 'Tab.', '§', 'Anhang', 'Z3', '2019', '0', 'Pkt. 0', 'OIB-330.6-138/25 SEPTEMBER 2025', 'U-Wert Bauteil › Neubau (2)', '']) {
      expect(addressOf(clause), clause).toBeUndefined()
    }
  })
})

describe('the check state of a route', () => {
  const [doc] = cardsOf(stairs)
  const withLine = (line: object) => ({ ...doc, line: { ...doc.line, ...line } })
  test('a check that is due names the day of the last one', () => {
    const due = withLine({ role_labels: ['check_overdue'], last_checked_at: '2025-03-01' })
    expect(basisLines(t, [due]).law[0].text).toContain('seit 01.09.2020, laut Plattformdaten, zuletzt am 01.03.2025 an der Quelle geprüft)')
  })
  test('an uncurated source says so', () => {
    const raw = withLine({ role_labels: ['uncurated_source'], last_checked_at: null })
    expect(basisLines(t, [raw]).law[0].text).toContain('seit 01.09.2020, amtliche Quelle, nicht kuratiert)')
  })
})

describe('the card names an address, the hover the passage', () => {
  const heading = 'Anforderungen an wärmeübertragende Bauteile beim Neubau (Gebäudekategorie 1 bis 12) › U-Wert Bauteil [W/m²K]'
  const doc = (loci: { clause?: string; page?: number; number?: number }[]) =>
    ({
      key: 'oib-6',
      title: 'OIB-Richtlinie 6, Ausgabe April 2019',
      loci: loci.map((locus, i) => ({ key: String(i), isCited: true, ...locus })),
    }) as unknown as Parameters<typeof documentLocation>[1]

  test('a heading trail, a cover number and the Vorbemerkungen leave the page alone', () => {
    expect(documentLocation(t, doc([{ clause: heading, page: 7 }]))).toBe('S.\u00A07')
    expect(documentLocation(t, doc([{ clause: 'OIB-330.6-138/25 SEPTEMBER 2025', page: 1 }]))).toBe('S.\u00A01')
    expect(documentLocation(t, doc([{ clause: '0', page: 4 }]))).toBe('S.\u00A04')
  })

  test('the card reads the addresses and the pages, the hover every passage', () => {
    const cited = doc([
      { clause: heading, page: 7, number: 1 },
      { clause: `${heading} (2)`, page: 8, number: 3 },
      { clause: 'Tabelle 3', page: 10, number: 4 },
    ])
    expect(documentLocation(t, cited)).toBe('Tabelle 3 · S.\u00A07\u20138, 10')
    expect(documentLocationDetail(t, cited)?.split('\n')).toEqual([
      `[1] · S.\u00A07 · ${heading}`,
      `[3] · S.\u00A08 · ${heading} (2)`,
      '[4] · S.\u00A010 · Tabelle 3',
    ])
  })

  test('past two addresses the card counts the rest', () => {
    expect(documentLocation(t, doc([{ clause: '2.1' }, { clause: '2.2' }, { clause: '§ 1' }]))).toBe('Pkt.\u00A02.1, Pkt.\u00A02.2, +1 weitere')
  })

  test('consecutive pages are a range', () => {
    expect(pageRanges([10, 7, 8, 8, 12])).toBe('7\u20138, 10, 12')
  })
})
