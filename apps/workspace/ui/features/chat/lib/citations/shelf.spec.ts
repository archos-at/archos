/**
 * @vitest-environment node
 */

import { describe, test, expect } from 'vitest'
import { chatCopy } from '@/i18n/namespaces/chat'
import { getByPath } from '@/i18n/translate'
import { buildCitationModel, decodeCitations, documentShelfLabel, documentTabLabel } from './index'
import { citationFromWire } from '../wire-citation'
import { parseKbLocator } from './locator'
import { encodeCitations } from './persistence'
import type { CitationSource, WireCitationSource } from '../../types'

const NOW = new Date('2026-08-12T09:00:00Z')

const wire = (overrides: Partial<WireCitationSource>): WireCitationSource => ({
  content: '[KB] Grundriss.pdf, p.2',
  file_name: 'Grundriss.pdf',
  page: 2,
  origin: 'kb',
  kind: 'project',
  ...overrides,
})

const documentFor = (source: WireCitationSource) => {
  const [document] = buildCitationModel({
    citations: [citationFromWire(source, { timestamp: NOW })],
  })
  if (!document) throw new Error('fixture produced no document')
  return document
}

const t = (key: string): string =>
  key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], chatCopy.messages.de) as string

describe('the shelf arrives explicitly', () => {
  test('the wire field survives the mapping onto a citation', () => {
    expect(citationFromWire(wire({ shelf: 'session' }), { timestamp: NOW }).shelf).toBe('session')
    expect(citationFromWire(wire({ shelf: 'office_shelf' }), { timestamp: NOW }).shelf).toBe('office_shelf')
  })

  test('the model takes the shelf the payload states', () => {
    expect(documentFor(wire({ shelf: 'session' })).shelf).toBe('session')
    expect(documentFor(wire({ shelf: 'base', kind: 'building_law' })).shelf).toBe('base')
  })

  test('the shelf outranks the collection id, which no longer says anything', () => {
    const doc = documentFor(wire({ collection: 'proj_alpha', shelf: 'session' }))

    expect(doc.shelf).toBe('session')
    expect(doc.collection).toBe('proj_alpha')
  })

  test('a shelf survives being persisted and read back', () => {
    const citation = citationFromWire(wire({ shelf: 'session' }), { timestamp: NOW })
    const restored = decodeCitations(encodeCitations([citation]), NOW)

    expect(restored?.[0]?.shelf).toBe('session')
  })
})

describe('an unknown shelf renders unattributed', () => {
  test('a payload with no shelf leaves the document unattributed', () => {
    const doc = documentFor(wire({ collection: 'archiv_org1', kind: 'office' }))

    expect(doc.shelf).toBeUndefined()
    expect(documentShelfLabel(doc, t)).toBeUndefined()
  })

  test('an unrecognised shelf value is dropped, not defaulted to base law', () => {
    const doc = documentFor(wire({ shelf: 'building_law', collection: 'oib_knowledge' }))

    expect(doc.shelf).toBeUndefined()
    expect(documentShelfLabel(doc, t)).toBeUndefined()
  })

  test('an unattributed document still renders its display taxonomy', () => {
    const doc = documentFor(wire({ collection: 'archiv_org1', kind: 'office' }))

    expect(doc.kind).toBe('office')
    expect(documentTabLabel(doc, t)).toBe('Büroablage')
  })

  test('a stored message written before the field existed decodes to no shelf', () => {
    const restored = decodeCitations(
      { v: 1, sources: [{ content: '[KB] Plan.pdf, p.1', file_name: 'Plan.pdf', page: 1 }] },
      NOW
    )

    expect(restored?.[0]?.shelf).toBeUndefined()
  })
})

describe('a private session attachment is not project knowledge', () => {
  test('a session source is labelled "Private Sitzung", never "Projektwissen"', () => {
    const doc = documentFor(wire({ shelf: 'session', kind: 'project' }))

    expect(documentShelfLabel(doc, t)).toBe('Private Sitzung')
    expect(documentTabLabel(doc, t)).toBe('Private Sitzung')
    expect(documentTabLabel(doc, t)).not.toBe('Projektwissen')
  })

  test('a genuine project document is still Projektwissen', () => {
    const doc = documentFor(wire({ shelf: 'project', kind: 'project' }))

    expect(documentTabLabel(doc, t)).toBe('Projektwissen')
  })

  test('a fine lane label still wins — the shelf does not overwrite the taxonomy', () => {
    const doc = documentFor(
      wire({ shelf: 'base', kind: 'building_law', lane: 'building_law_oib', lane_label: 'OIB-Richtlinie' })
    )

    expect(doc.shelf).toBe('base')
    expect(documentTabLabel(doc, t)).toBe('OIB-Richtlinie')
  })

  test('the lane is named in the reader’s language, never in the wire’s German label', () => {
    const tEn = (key: string) => getByPath(chatCopy.messages.en, key) as string
    const oib = documentFor(
      wire({ shelf: 'base', kind: 'building_law', lane: 'building_law_oib', lane_label: 'OIB-Richtlinie' })
    )
    expect(documentTabLabel(oib, tEn)).toBe('OIB guideline')
    const federal = documentFor(
      wire({ kind: 'building_law', lane: 'building_law_federal', lane_label: 'Bundesrecht' })
    )
    expect(documentTabLabel(federal, tEn)).toBe('Federal law')
    const project = documentFor(
      wire({ shelf: 'project', kind: 'project', lane: 'project', lane_label: 'Projektwissen' })
    )
    expect(documentTabLabel(project, tEn)).toBe('Project knowledge')
  })
})

describe('legacy citation keys still parse', () => {
  const legacy = (citationKey: string): CitationSource => ({
    id: 'c-1',
    content: `[KB] ${citationKey}`,
    citationKey,
    timestamp: NOW,
    isCited: true,
  })

  test('a German qualifier in a persisted key names the shelf', () => {
    const [officeShelf] = buildCitationModel({ citations: [legacy('Plan.pdf (Büroablage), p.3')] })
    const [projekt] = buildCitationModel({ citations: [legacy('Plan.pdf (Projektwissen), p.3')] })
    const [basis] = buildCitationModel({ citations: [legacy('Plan.pdf (Basiswissen), p.3')] })

    expect(officeShelf?.shelf).toBe('office_shelf')
    expect(projekt?.shelf).toBe('project')
    expect(basis?.shelf).toBe('base')
  })

  test('the qualifier is not part of the filename', () => {
    const [doc] = buildCitationModel({ citations: [legacy('Plan.pdf (Büroablage), p.3')] })

    expect(doc?.fileName).toBe('Plan.pdf')
    expect(doc?.loci[0]?.page).toBe(3)
  })

  test('an explicit shelf beats the legacy qualifier when a key carries both', () => {
    const [doc] = buildCitationModel({
      citations: [
        citationFromWire(
          {
            content: '[KB] Plan.pdf (Projektwissen), p.3',
            citation_key: 'Plan.pdf (Projektwissen), p.3',
            file_name: 'Plan.pdf',
            page: 3,
            shelf: 'session',
          },
          { timestamp: NOW }
        ),
      ],
    })

    expect(doc?.shelf).toBe('session')
  })

  describe('explicit and guessed shelves do not compete on arrival order', () => {
    const guessed: CitationSource = {
      id: 'c-guess',
      content: '[KB] Plan.pdf (Projektwissen), p.3',
      citationKey: 'Plan.pdf (Projektwissen), p.3',
      fileName: 'Plan.pdf',
      page: 3,
      timestamp: NOW,
      isCited: true,
    }

    const stated: CitationSource = {
      id: 'c-wire',
      content: '[KB] Plan.pdf, p.4',
      citationKey: 'Plan.pdf, p.4',
      fileName: 'Plan.pdf',
      page: 4,
      shelf: 'session',
      timestamp: NOW,
      isCited: true,
    }

    test('the explicit shelf wins even when the qualifier arrives FIRST', () => {
      const [doc] = buildCitationModel({ citations: [guessed, stated] })

      expect(doc?.shelf).toBe('session')
      expect(doc?.loci.map((locus) => locus.page)).toEqual([3, 4])
    })

    test('and still wins when it arrives first — order changes nothing', () => {
      const [doc] = buildCitationModel({ citations: [stated, guessed] })

      expect(doc?.shelf).toBe('session')
    })

    test('a second explicit shelf does not unseat the first', () => {
      const [doc] = buildCitationModel({
        citations: [stated, { ...guessed, id: 'c-later', shelf: 'office_shelf' }],
      })

      expect(doc?.shelf).toBe('session')
    })

    test('the qualifier is still used when nothing states a shelf', () => {
      const [doc] = buildCitationModel({ citations: [guessed] })

      expect(doc?.shelf).toBe('project')
    })

    test('prose the model wrote cannot overrule a shelf a wire source guessed', () => {
      const [doc] = buildCitationModel({
        citations: [
          {
            ...guessed,
            content: '[KB] Plan.pdf (Büroablage), p.3',
            citationKey: 'Plan.pdf (Büroablage), p.3',
          },
        ],
        entries: [{ number: 1, markdown: 'Plan.pdf (Projektwissen), p.4' }],
      })

      expect(doc?.shelf).toBe('office_shelf')
    })
  })

  test('an unknown qualifier leaves the document unattributed', () => {
    const [doc] = buildCitationModel({
      citations: [{ ...legacy('Bescheid (Kopie).pdf, p.2'), fileName: 'Bescheid (Kopie).pdf' }],
    })

    expect(doc?.shelf).toBeUndefined()
    expect(doc?.fileName).toBe('Bescheid (Kopie).pdf')
  })
})

describe('citation-key qualifiers the backend can write', () => {
  const cases: ReadonlyArray<readonly [qualifier: string, shelf: string]> = [
    ['Büroablage', 'office_shelf'],
    ['Projektwissen', 'project'],
    ['Basiswissen', 'base'],
    ['Private Sitzung', 'session'],
    ['Büroarchiv', 'office_shelf'],
  ]

  test.each(cases)('strips %s and resolves it to the %s shelf', (qualifier, shelf) => {
    const parsed = parseKbLocator(`Plan.pdf (${qualifier}), p.3`)
    expect(parsed).not.toBeNull()
    expect(parsed?.filename).toBe('Plan.pdf')
    expect(parsed?.shelf).toBe(shelf)
  })

  test('a parenthetical that is part of the filename is left alone', () => {
    const parsed = parseKbLocator('Bescheid (Kopie).pdf, p.1')
    expect(parsed?.filename).toBe('Bescheid (Kopie).pdf')
    expect(parsed?.shelf).toBeUndefined()
  })
})
