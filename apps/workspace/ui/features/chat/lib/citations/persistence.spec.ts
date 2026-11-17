import { describe, expect, it } from 'vitest'
import { decodeCitations, encodeCitations, CITATIONS_PAYLOAD_VERSION } from './persistence'
import { buildCitationModel } from './build'
import { citationNumbers, citedPages } from './model'
import type { CitationSource } from '../../types'

const WHEN = new Date('2026-07-28T12:00:00Z')

const source = (page: number, number: number): CitationSource => ({
  id: `c${number}`,
  content: `[KB] oib-rl_2.1_ausgabe_mai_2023.pdf, p.${page}`,
  timestamp: WHEN,
  title: 'OIB-Richtlinie 2.1, Ausgabe Mai 2023',
  citationKey: `oib-rl_2.1_ausgabe_mai_2023.pdf, p.${page}`,
  documentId: 'doc:oib_knowledge:oib-rl_2.1_ausgabe_mai_2023.pdf',
  collection: 'oib_knowledge',
  fileName: 'oib-rl_2.1_ausgabe_mai_2023.pdf',
  kind: 'building_law',
  lane: 'building_law_oib',
  laneLabel: 'OIB-Richtlinie',
  origin: 'kb',
  page,
  number,
  isCited: true,
})

describe('citation persistence', () => {
  it('round-trips a turn without losing anything a surface renders', () => {
    const original = [source(5, 1), source(18, 2)]
    const restored = decodeCitations(encodeCitations(original), WHEN)!

    expect(restored).toHaveLength(2)
    const [doc] = buildCitationModel({ citations: restored })
    expect(doc!.title).toBe('OIB-Richtlinie 2.1, Ausgabe Mai 2023')
    expect(doc!.authority).toBe('OIB')
    expect(doc!.tint).toBe('oib')
    expect(citedPages(doc!)).toEqual([5, 18])
    expect(citationNumbers(doc!)).toEqual([1, 2])
  })

  it('keeps a plan\u2019s regions, so a reload still marks the drawing (#433)', () => {
    const regions = [{ box: [0.1, 0.2, 0.5, 0.6] as [number, number, number, number], label: 'Grundriss EG' }]
    const [restored] = decodeCitations(encodeCitations([{ ...source(4, 1), regions }]), WHEN)!
    expect(restored!.regions).toEqual(regions)
    const [doc] = buildCitationModel({ citations: [restored!] })
    expect(doc!.loci[0]!.regions).toEqual(regions)
  })

  it('keeps a precedent’s Land across a reload, so the reloaded chip still says where it applies (ADR-0094)', () => {
    const project = {
      id: 'p9',
      name: 'Wohnbau Graz',
      status: 'closed' as const,
      federalStateNote: 'Steiermark — nicht das Bundesland dieses Projekts',
    }
    const [restored] = decodeCitations(encodeCitations([{ ...source(3, 1), project }]), WHEN)!
    expect(restored!.project).toEqual(project)
  })

  it('carries the version explicitly rather than leaving it to be guessed', () => {
    expect(encodeCitations([source(5, 1)])!.v).toBe(CITATIONS_PAYLOAD_VERSION)
  })

  it('stores nothing for a turn with no citations', () => {
    expect(encodeCitations([])).toBeUndefined()
    expect(encodeCitations(undefined)).toBeUndefined()
  })

  it('keeps the retrieved-but-not-cited distinction', () => {
    const restored = decodeCitations(
      encodeCitations([{ ...source(5, 1), isCited: false }]),
      WHEN
    )!
    expect(restored[0]!.isCited).toBe(false)
  })

  it('reads the pre-envelope array already sitting in local storage', () => {
    const legacy = [
      {
        content: '[KB] oib-rl_2.1_ausgabe_mai_2023.pdf, p.5',
        citationKey: 'oib-rl_2.1_ausgabe_mai_2023.pdf, p.5',
        fileName: 'oib-rl_2.1_ausgabe_mai_2023.pdf',
        laneLabel: 'OIB-Richtlinie',
        lane: 'building_law_oib',
        kind: 'building_law',
        page: 5,
        number: 1,
        isCited: true,
      },
    ]
    const restored = decodeCitations(legacy, WHEN)!
    expect(restored).toHaveLength(1)
    const [doc] = buildCitationModel({ citations: restored })
    expect(doc!.fileName).toBe('oib-rl_2.1_ausgabe_mai_2023.pdf')
    expect(doc!.authority).toBe('OIB')
    expect(citedPages(doc!)).toEqual([5])
  })

  it('decodes garbage to nothing rather than to a half-populated citation', () => {
    expect(decodeCitations(undefined, WHEN)).toBeUndefined()
    expect(decodeCitations({ v: 99, sources: [{}] }, WHEN)).toBeUndefined()
    expect(decodeCitations('not a payload', WHEN)).toBeUndefined()
    expect(decodeCitations({ sources: 'nope' }, WHEN)).toBeUndefined()
  })

  it('gives restored citations stable ids so history does not remount on load', () => {
    const payload = encodeCitations([source(5, 1), source(18, 2)])
    const first = decodeCitations(payload, WHEN)!
    const second = decodeCitations(payload, WHEN)!
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id))
  })
})

describe('untrusted stored payloads', () => {
  it('a legacy row with a non-string field decodes to nothing, never a crash', () => {
    const legacy = [{ title: 123, citation_key: { nope: true }, content: 'x' }]
    expect(() => decodeCitations(legacy, WHEN)).not.toThrow()
    expect(decodeCitations(legacy, WHEN)).toBeUndefined()
  })

  it('a well-formed legacy row alongside a malformed one is not silently half-read', () => {
    const rows = [
      { content: '[KB] Plan.pdf, p.1', citationKey: 'Plan.pdf, p.1', fileName: 'Plan.pdf' },
      { content: 'x', title: { not: 'a string' } },
    ]
    expect(decodeCitations(rows, WHEN)).toBeUndefined()
  })
})

describe('a message stored before the English names', () => {
  it('still decodes the old project note', () => {
    const stored = {
      v: 1,
      sources: [
        {
          citation_key: 'k',
          content: 'c',
          project: { id: 'p9', name: 'Wohnbau Graz', status: 'closed', landNote: 'Steiermark' },
        },
      ],
    }
    const [source] = decodeCitations(stored, new Date(0)) ?? []
    expect(source?.project?.federalStateNote).toBe('Steiermark')
  })
})
