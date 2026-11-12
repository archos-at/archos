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
  locusLabel,
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
    expect(law[0]).toBe('OIB-Richtlinie 4, Ausgabe April 2019 (verbindlich über StBTV 2020 seit 01.09.2020, laut Plattformdaten, noch nicht an der Quelle geprüft), Tabelle 3 · S. 4, 10')
    // Law read live keeps its own title and has no route: it is law in its own territory.
    expect(law[1]).toBe('Steiermärkische Bautechnikverordnung 2020 – StBTV 2020, § 1')
    for (const text of law) expect(text).not.toMatch(FILE_NAME)
  })

  test('an act whose provision is a gazette number is said with its designation in front', () => {
    const [line] = basisLines(t, cardsOf(uValue)).law
    expect(line.numbers).toEqual([1, 2])
    expect(line.text.startsWith('OIB-Richtlinie 6, Ausgabe 2025 (verbindlich über WBTV, LGBl. 26/2026 seit 15.07.2026, laut Plattformdaten, noch nicht an der Quelle geprüft)')).toBe(true)
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

describe('locusLabel', () => {
  test('only a numbered point is called one, and a named clause keeps its page', () => {
    expect(locusLabel(t, { key: 'a', isCited: true, clause: '3.2.1' })).toBe('Pkt. 3.2.1')
    expect(locusLabel(t, { key: 'b', isCited: true, clause: '§ 1' })).toBe('§ 1')
    expect(locusLabel(t, { key: 'c', isCited: true, clause: 'Tabelle 3', page: 10 })).toBe('Tabelle 3, S.\u00A010')
    expect(locusLabel(t, { key: 'e', isCited: true, clause: '3.2.1', page: 10 })).toBe('Pkt.\u00A03.2.1')
    expect(locusLabel(t, { key: 'd', isCited: true, clause: 'Pkt. 4.2' })).toBe('Pkt. 4.2')
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

  test('a heading trail, a cover number and the Vorbemerkungen are no address', () => {
    expect(locusLabel(t, { key: 'h', isCited: true, clause: heading, page: 7 })).toBe('S.\u00A07')
    expect(locusLabel(t, { key: 'c', isCited: true, clause: 'OIB-330.6-138/25 SEPTEMBER 2025', page: 1 })).toBe('S.\u00A01')
    expect(locusLabel(t, { key: 'z', isCited: true, clause: '0', page: 4 })).toBe('S.\u00A04')
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
