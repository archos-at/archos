import { describe, expect, test } from 'vitest'
import { translatorFor } from '@/i18n/namespace'
import { chatCopy } from '@/i18n/namespaces/chat'
import stairs from '@/test-utils/stored-answers/graz-stairs.json'
import uValue from '@/test-utils/stored-answers/wien-u-value.json'
import { buildCitationModel } from './citations'
import { adoptingAct, basisLines, cardName, locusLabel } from './derivation-basis'
import { documentShortName } from './document-names'
import { mapServerMessageToChatMessage } from './server-message-mapper'

/** The cards of a stored answer, read back the way a reload reads it. */
const cardsOf = (stored: typeof stairs | typeof uValue) =>
  buildCitationModel({ citations: mapServerMessageToChatMessage(stored.answer)?.citations ?? [] })

const t = translatorFor(chatCopy, 'de')
const FILE_NAME = /\.pdf\b|text-[0-9a-f]{6,}/

describe('the Herleitung names a cited edition by its records, never by its file', () => {
  test('the last card says the edition, the act it is binding through, then the passage', () => {
    const law = basisLines(t, cardsOf(stairs)).law.map((line) => line.text)
    expect(law[0]).toBe('OIB-Richtlinie 4, Ausgabe April 2019 (verbindlich über StBTV 2020), Tabelle 3, S. 10, S. 4')
    // Law read live keeps its own title and has no route: it is law in its own territory.
    expect(law[1]).toBe('Steiermärkische Bautechnikverordnung 2020 – StBTV 2020, § 1')
    for (const text of law) expect(text).not.toMatch(FILE_NAME)
  })

  test('an act whose provision is a gazette number is said with its designation in front', () => {
    const [line] = basisLines(t, cardsOf(uValue)).law
    expect(line.numbers).toEqual([1, 2])
    expect(line.text.startsWith('OIB-Richtlinie 6, Ausgabe 2025 (verbindlich über WBTV, LGBl. 26/2026)')).toBe(true)
    expect(line.text).not.toMatch(FILE_NAME)
  })

  test('the card in the fan reads its name off the same records', () => {
    for (const doc of [...cardsOf(stairs), ...cardsOf(uValue)]) {
      expect(cardName(doc)).not.toMatch(FILE_NAME)
      expect(documentShortName(doc.fileName ?? doc.title, doc.title)).not.toMatch(FILE_NAME)
    }
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
