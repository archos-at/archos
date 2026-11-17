/**
 * @vitest-environment node
 */

import { describe, expect, test } from 'vitest'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { TraceLaneCard } from '@/lib/conversations/message-provenance'
import { deriveTraceLanes } from '../trace-lanes'
import { storedStep } from '@/test-utils/wire-v2-steps'
import { buildCitationModel } from './build'
import { citedPages, documentPages, isCited, readPages } from './model'
import { documentTabLabel, totalHits } from './views'

const lane = (overrides: Partial<TraceLaneCard>): TraceLaneCard => ({
  key: 'building_law_oib',
  label: 'OIB-Richtlinie',
  kind: 'building_law',
  signal: 'law',
  hitCount: 1,
  sources: [],
  ...overrides,
})

const kbSources = storedStep({
  id: 'sources:0:knowledge_search:1',
  kind: 'sources',
  tool: 'knowledge_search',
  lanes: [
    {
      key: 'project',
      label: 'Projektwissen',
      kind: 'project',
      hit_count: 2,
      sources: [
        { name: 'Brandschutzkonzept.pdf', detail: 'p.4' },
        { name: 'Mustervorlage.pdf', detail: 'p.1' },
      ],
    },
  ],
})

const t = (key: string): string =>
  key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], chatCopy.messages.de) as string

describe('the fan-out is the model, grouped by document', () => {
  test('several pages of one document are one card with a Treffer count', () => {
    const docs = buildCitationModel({
      traceLanes: [
        lane({
          hitCount: 3,
          sources: [
            { name: 'OIB-RL_2.pdf', detail: 'p.1' },
            { name: 'OIB-RL_2.pdf', detail: 'p.2' },
            { name: 'OIB-RL_4.pdf', detail: 'p.5' },
          ],
        }),
      ],
    })

    expect(docs).toHaveLength(2)
    const oib2 = docs.find((doc) => doc.fileName === 'OIB-RL_2.pdf')!
    expect(documentTabLabel(oib2, t)).toBe('OIB-Richtlinie')
    expect(oib2.tint).toBe('oib')
    expect(oib2.authority).toBe('OIB')
    expect(oib2.loci).toHaveLength(2)
    expect(readPages(oib2)).toEqual([1, 2])
    expect(citedPages(oib2)).toEqual([])
    expect(documentPages(oib2)).toEqual([1, 2])
    expect(totalHits(docs)).toBe(3)
  })

  test('a card carries the display name, never the raw corpus filename', () => {
    const [doc] = buildCitationModel({
      traceLanes: [lane({ sources: [{ name: 'oib-rl_2_ausgabe_mai_2023.pdf' }] })],
    })
    expect(doc!.title).toBe('OIB-Richtlinie 2, Ausgabe Mai 2023')
    expect(doc!.fileName).toBe('oib-rl_2_ausgabe_mai_2023.pdf')
  })

  test('an authoritative title from the wire wins over the client derivation', () => {
    const [doc] = buildCitationModel({
      traceLanes: [
        lane({
          sources: [{ name: 'oib-rl_2_ausgabe_mai_2023.pdf', title: 'Hausregel Brandschutz' }],
        }),
      ],
    })
    expect(doc!.title).toBe('Hausregel Brandschutz')
  })

  test('carries the same OIB/RIS authority badge as the Belegt-durch chips', () => {
    const badgeFor = (card: TraceLaneCard): string | undefined =>
      buildCitationModel({ traceLanes: [card] })[0]?.authority

    expect(badgeFor(lane({ sources: [{ name: 'x.pdf' }] }))).toBe('OIB')
    expect(
      badgeFor(
        lane({ key: 'building_law_ris', label: 'Rechtsquelle (RIS)', sources: [{ name: 'BO Wien' }] })
      )
    ).toBe('RIS')
    expect(
      badgeFor(
        lane({
          key: 'office',
          label: 'Büroablage',
          kind: 'office',
          signal: 'office',
          sources: [{ name: 'detail.pdf' }],
        })
      )
    ).toBeUndefined()
  })

  test('one card per document from a live sources step', () => {
    const docs = buildCitationModel({ traceLanes: deriveTraceLanes([kbSources]) })
    expect(docs.map((doc) => doc.title).sort()).toEqual(['Brandschutzkonzept', 'Mustervorlage'])
    expect(docs.every((doc) => !isCited(doc))).toBe(true)
  })

  test('a web lane keeps its hostname as the name and links out', () => {
    const [doc] = buildCitationModel({
      traceLanes: [
        lane({
          key: 'web',
          label: 'Web',
          kind: 'web',
          signal: 'auto',
          sources: [
            { name: 'example.org', title: 'example.org', detail: 'https://example.org/doc' },
          ],
        }),
      ],
    })
    expect(doc!.title).toBe('example.org')
    expect(doc!.url).toBe('https://example.org/doc')
    expect(doc!.tint).toBe('auto')
  })
})

describe('robustness at the edges', () => {
  test('a source identified by nothing at all never becomes a card', () => {
    const docs = buildCitationModel({
      citations: [
        {
          id: 'ghost',
          content: '',
          timestamp: new Date(0),
          kind: 'building_law',
          lane: 'building_law_oib',
          laneLabel: 'OIB-Richtlinie',
        },
      ],
    })
    expect(docs).toEqual([])
  })

  test('a label-only trace hit and the cited source it names are ONE document', () => {
    const docs = buildCitationModel({
      traceLanes: [
        lane({
          key: 'building_law_ris',
          label: 'Bundesrecht',
          sources: [{ name: 'Bauordnung für Wien', detail: '§ 108 Fluchtwege' }],
        }),
      ],
      citations: [
        {
          id: 'ris',
          content: '[RIS] Bauordnung für Wien § 108',
          url: 'https://www.ris.bka.gv.at/x',
          title: 'Bauordnung für Wien',
          timestamp: new Date(0),
          kind: 'building_law',
          lane: 'building_law_ris',
          number: 2,
          isCited: true,
        },
      ],
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.title).toBe('Bauordnung für Wien')
    expect(isCited(docs[0]!)).toBe(true)
    expect(docs[0]!.url).toBe('https://www.ris.bka.gv.at/x')
  })
})
