import { describe, expect, it } from 'vitest'
import {
  citationShareUrl,
  encodeCitationLink,
  parseCitationLink,
  resolveCitationLink,
} from './deep-link'
import { buildCitationModel } from './build'
import type { CitationSource } from '../../types'

const at = new Date(0)
const FILE = 'oib-rl_2.1_ausgabe_mai_2023.pdf'

const locus = (page: number, number: number): CitationSource => ({
  id: `c${number}`,
  content: `[KB] ${FILE}, p.${page}`,
  citationKey: `${FILE}, p.${page}`,
  fileName: FILE,
  collection: 'oib_knowledge',
  title: 'OIB-Richtlinie 2.1, Ausgabe Mai 2023',
  kind: 'building_law',
  lane: 'building_law_oib',
  origin: 'kb',
  timestamp: at,
  page,
  number,
  isCited: true,
})

const documents = buildCitationModel({ citations: [locus(5, 1), locus(18, 2)] })
const document = documents[0]!

describe('citation deep links', () => {
  it('round-trips a reference to one passage', () => {
    const ref = { document, locus: document.loci[1]! }
    const restored = resolveCitationLink(parseCitationLink(encodeCitationLink(ref)), documents)

    expect(restored?.document.id).toBe(document.id)
    expect(restored?.locus?.page).toBe(18)
  })

  it('round-trips a reference to the document as a whole', () => {
    const restored = resolveCitationLink(parseCitationLink(encodeCitationLink({ document })), documents)
    expect(restored?.document.id).toBe(document.id)
    expect(restored?.locus).toBeUndefined()
  })

  it('survives the separator appearing inside a document id', () => {
    const odd = buildCitationModel({
      citations: [{ ...locus(3, 1), fileName: 'Plan~Rev~2.pdf', citationKey: 'Plan~Rev~2.pdf, p.3' }],
    })
    const ref = { document: odd[0]!, locus: odd[0]!.loci[0]! }
    const restored = resolveCitationLink(parseCitationLink(encodeCitationLink(ref)), odd)

    expect(restored?.document.id).toBe(odd[0]!.id)
    expect(restored?.locus?.page).toBe(3)
  })

  it('survives a comma in the document id read straight off a URL', () => {
    const comma = buildCitationModel({
      citations: [{ ...locus(3, 1), fileName: 'Plan,Rev.pdf', citationKey: 'Plan,Rev.pdf, p.3' }],
    })
    const ref = { document: comma[0]!, locus: comma[0]!.loci[0]! }
    const url = new URL(`https://app.example/app/chat?cite=${encodeCitationLink(ref)}`)
    const restored = resolveCitationLink(parseCitationLink(url.searchParams.get('cite')), comma)

    expect(comma[0]!.id).toContain(',')
    expect(restored?.document.id).toBe(comma[0]!.id)
    expect(restored?.locus?.page).toBe(3)
  })

  it('opens the document when the linked passage no longer exists', () => {
    const stale = parseCitationLink(
      encodeCitationLink({ document, locus: { ...document.loci[0]!, key: 'p:999' } })
    )
    const restored = resolveCitationLink(stale, documents)

    expect(restored?.document.id).toBe(document.id)
    expect(restored?.locus).toBeUndefined()
  })

  it('an answer that does not hold the linked document resolves to nothing', () => {
    const other = buildCitationModel({
      citations: [{ ...locus(1, 1), fileName: 'Andere.pdf', citationKey: 'Andere.pdf, p.1' }],
    })
    expect(resolveCitationLink(parseCitationLink(encodeCitationLink({ document })), other)).toBeNull()
  })

  it('a mangled link degrades to nothing rather than throwing', () => {
    expect(parseCitationLink('doc:oib_knowledge:file.pdf,p:3')).toBeNull()
    expect(parseCitationLink('%E0%A4%A')).toBeNull()
    expect(parseCitationLink('')).toBeNull()
    expect(parseCitationLink(null)).toBeNull()
    expect(resolveCitationLink(null, documents)).toBeNull()
  })

  it('builds a shareable URL that keeps the page it was shared from', () => {
    const url = citationShareUrl(
      { document, locus: document.loci[1]! },
      { origin: 'https://app.example', pathname: '/app/chat', search: '?project=abc' }
    )
    const parsed = new URL(url)

    expect(parsed.searchParams.get('project')).toBe('abc')
    expect(resolveCitationLink(parseCitationLink(parsed.searchParams.get('cite')), documents)?.locus?.page).toBe(18)
  })
})
