import { describe, expect, it, test } from 'vitest'
import type { ReportSourceEntry } from '@/features/layout/lib/report-citations'
import type { TraceLaneCard } from '@/lib/conversations/message-provenance'
import type { CitationSource } from '../../types'
import { buildCitationModel } from './build'
import {
  answerDocuments,
  answerSourceAnchorPrefix,
  bibliographyRows,
  splitAnswerBody,
  unusedDocuments,
} from './views'
import { CitationAccumulator, citationNumbers, citedPages, isCited } from './model'

const OIB_FILE = 'oib-rl_2.1_ausgabe_mai_2023.pdf'
const OIB_TITLE = 'OIB-Richtlinie 2.1, Ausgabe Mai 2023'

const wireLocus = (number: number, page: number): CitationSource => ({
  id: `c${number}`,
  content: `[KB] ${OIB_FILE}, p.${page}`,
  timestamp: new Date(0),
  origin: 'kb',
  kind: 'building_law',
  lane: 'building_law_oib',
  laneLabel: 'OIB-Richtlinie',
  title: OIB_TITLE,
  citationKey: `${OIB_FILE}, p.${page}`,
  collection: 'oib_knowledge',
  fileName: OIB_FILE,
  page,
  number,
  isCited: true,
})

const writtenEntry = (number: number, page: number): ReportSourceEntry => ({
  number,
  markdown: `${OIB_FILE}, p.${page}`,
  sourceKind: 'kb',
})

describe('buildCitationModel', () => {
  it('folds one document cited at four pages into ONE document with four loci', () => {
    const docs = buildCitationModel({
      citations: [wireLocus(1, 5), wireLocus(2, 12), wireLocus(3, 18), wireLocus(4, 22)],
      entries: [writtenEntry(1, 5), writtenEntry(2, 12), writtenEntry(3, 18), writtenEntry(4, 22)],
    })

    expect(docs).toHaveLength(1)
    const doc = docs[0]!
    expect(doc.title).toBe(OIB_TITLE)
    expect(doc.authority).toBe('OIB')
    expect(doc.tint).toBe('oib')
    expect(doc.kind).toBe('building_law')
    expect(citedPages(doc)).toEqual([5, 12, 18, 22])
    expect(citationNumbers(doc)).toEqual([1, 2, 3, 4])
  })

  it('keeps every [N] addressable — one bibliography row per inline marker', () => {
    const docs = buildCitationModel({
      citations: [wireLocus(1, 5), wireLocus(2, 12)],
      entries: [writtenEntry(1, 5), writtenEntry(2, 12)],
    })
    expect(answerDocuments(docs)).toHaveLength(1)
    expect(bibliographyRows(docs).map((row) => row.number)).toEqual([1, 2])
  })

  it('gives a written entry with no structured match the same identity as one with', () => {
    const docs = buildCitationModel({ entries: [writtenEntry(1, 7)] })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.title).toBe(OIB_TITLE)
    expect(docs[0]!.fileName).toBe(OIB_FILE)
    expect(citedPages(docs[0]!)).toEqual([7])
  })

  it('never merges same-named documents from different shelves', () => {
    const projectPlan: CitationSource = {
      id: 'p',
      content: 'Plan.pdf, p.1',
      timestamp: new Date(0),
      kind: 'project',
      collection: 'proj_abc',
      fileName: 'Plan.pdf',
      page: 1,
      isCited: true,
    }
    const officeShelfPlan: CitationSource = {
      ...projectPlan,
      id: 'a',
      kind: 'office',
      collection: 'archiv_xyz',
    }
    const docs = buildCitationModel({ citations: [projectPlan, officeShelfPlan] })
    expect(docs).toHaveLength(2)
    expect(docs.map((doc) => doc.kind).sort()).toEqual(['office', 'project'])
  })

  it('does not collapse a file that merely MENTIONS a guideline onto the card naming it', () => {
    const docs = buildCitationModel({
      entries: [
        { number: 1, markdown: 'OIB-Richtlinie 6', sourceKind: 'kb' },
        { number: 2, markdown: '[KB] OIB-Richtlinie 6 Kommentar.pdf, p.9', sourceKind: 'kb' },
      ],
    })

    expect(docs).toHaveLength(2)
    expect(docs.map((doc) => doc.title).sort()).toEqual([
      'OIB-Richtlinie 6',
      'OIB-Richtlinie 6 Kommentar',
    ])
  })

  it('keeps a live law\'s own title when a later observation of it carries none', () => {
    const line = { work_id: 'work:xa-act', edition_id: 'edition:xa-act-2023', designation: 'XA Act', edition_label: 'LGBl. 37/2023' }
    const accumulator = new CitationAccumulator()
    accumulator.add({ identity: { url: 'https://law.example/xa-act' }, url: 'https://law.example/xa-act', title: 'XA Building Act § 108', line })
    accumulator.add({ identity: { url: 'https://law.example/xa-act' }, url: 'https://law.example/xa-act', line })

    expect(accumulator.build().map((doc) => doc.title)).toEqual(['XA Building Act § 108'])
  })

  it('refuses the merge when the citation sits on another shelf', () => {
    const accumulator = new CitationAccumulator()
    accumulator.add({
      identity: { fileName: OIB_FILE, collection: 'p_1234' },
      fileName: OIB_FILE,
      shelf: 'project',
    })
    accumulator.add({ identity: { label: 'OIB-Richtlinie 2' }, title: 'OIB-Richtlinie 2' })

    expect(accumulator.build()).toHaveLength(2)
  })

  it('tells a corpus guideline apart from a file that merely mentions one', () => {
    const merges = (fileName: string, law: string): boolean => {
      const accumulator = new CitationAccumulator()
      accumulator.add({ identity: { fileName, collection: 'base' }, fileName })
      accumulator.add({ identity: { label: law }, title: law })
      return accumulator.build().length === 1
    }

    expect(merges('oib-rl_2.1_ausgabe_mai_2023.pdf', 'OIB-Richtlinie 2.1')).toBe(true)
    expect(merges('OIB-Richtlinie 2.1, Ausgabe Mai 2023', 'OIB-Richtlinie 2.1')).toBe(true)
    expect(merges('oib_richtlinie_3_erlaeuterungen.pdf', 'OIB-Richtlinie 3 Erläuterungen')).toBe(
      true
    )
    expect(merges('oib-rl_4_leitfaden_ausgabe_2023.pdf', 'OIB-Richtlinie 4 Leitfaden')).toBe(true)

    expect(merges('OIB-Richtlinie 6 Kommentar.pdf', 'OIB-Richtlinie 6')).toBe(false)
    expect(merges('Brandschutzkonzept nach OIB-Richtlinie 2.pdf', 'OIB-Richtlinie 2')).toBe(false)
    expect(merges('Sanierung Karlsplatz OIB 2.pdf', 'OIB-Richtlinie 2')).toBe(false)
  })

  it('applies the shelf rule to the INCOMING side too, not only the held one', () => {
    const accumulator = new CitationAccumulator()
    accumulator.add({ identity: { label: 'OIB-Richtlinie 2' }, title: 'OIB-Richtlinie 2' })
    accumulator.add({
      identity: { fileName: OIB_FILE, collection: 'p_1234' },
      fileName: OIB_FILE,
      shelf: 'project',
    })

    expect(accumulator.build()).toHaveLength(2)
  })

  it('separates what was read from what was used', () => {
    const lanes: TraceLaneCard[] = [
      {
        key: 'building_law_oib',
        label: 'OIB-Richtlinie',
        kind: 'building_law',
        signal: 'law',
        hitCount: 2,
        sources: [
          { name: OIB_FILE, title: OIB_TITLE, detail: 'p.5' },
          { name: 'oib-rl_4_ausgabe_mai_2023.pdf', title: 'OIB-Richtlinie 4', detail: 'p.9' },
        ],
      },
    ]
    const docs = buildCitationModel({ citations: [wireLocus(1, 5)], traceLanes: lanes })

    expect(docs).toHaveLength(2)
    expect(answerDocuments(docs).map((doc) => doc.fileName)).toEqual([OIB_FILE])
    expect(unusedDocuments(docs).map((doc) => doc.fileName)).toEqual([
      'oib-rl_4_ausgabe_mai_2023.pdf',
    ])
    const cited = answerDocuments(docs)[0]!
    expect(cited.loci).toHaveLength(1)
    expect(isCited(cited)).toBe(true)
  })

  it('gives an uncited document the shelf its trace-lane hit stated', () => {
    const lanes: TraceLaneCard[] = [
      {
        key: 'project',
        label: 'Projektwissen',
        kind: 'project',
        signal: 'project',
        hitCount: 1,
        sources: [{ name: 'Plan.pdf', detail: 'p.2', shelf: 'project' }],
      },
    ]
    const docs = buildCitationModel({ citations: [], traceLanes: lanes })

    expect(unusedDocuments(docs).map((doc) => doc.shelf)).toEqual(['project'])
  })

  it('keeps a web source linking out and tinted as web', () => {
    const web: CitationSource = {
      id: 'w',
      content: 'https://www.wko.at/artikel',
      url: 'https://www.wko.at/artikel',
      timestamp: new Date(0),
      kind: 'web',
      lane: 'web',
      origin: 'web',
      number: 1,
      isCited: true,
    }
    const docs = buildCitationModel({ citations: [web] })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.title).toBe('wko.at')
    expect(docs[0]!.tint).toBe('auto')
    expect(docs[0]!.url).toBe('https://www.wko.at/artikel')
  })

  it('is order-independent — a late citation_use only raises a locus', () => {
    const discovered: CitationSource = { ...wireLocus(0, 5), number: undefined, isCited: false }
    const used: CitationSource = { ...wireLocus(3, 5), title: undefined, laneLabel: undefined }

    const forward = buildCitationModel({ citations: [discovered, used] })[0]!
    const reverse = buildCitationModel({ citations: [used, discovered] })[0]!

    for (const doc of [forward, reverse]) {
      expect(doc.loci).toHaveLength(1)
      expect(doc.loci[0]!.isCited).toBe(true)
      expect(doc.loci[0]!.number).toBe(3)
      expect(doc.title).toBe(OIB_TITLE)
    }
  })
})

describe('splitAnswerBody', () => {
  test('lifts the written sources section out and reports its numbers', () => {
    const answer = [
      'Garagen brauchen zwei Fluchtwege [1] und 2,50 m Stellplatzbreite [2].',
      '',
      '## Quellen',
      '- [1] [RIS] Wiener Garagengesetz 2008 — https://www.ris.bka.gv.at/x',
      '- [2] [KB] oib-rl_4_ausgabe_mai_2023.pdf, p.9',
    ].join('\n')

    const { body, entries, numbers } = splitAnswerBody(answer)

    expect(entries).toHaveLength(2)
    expect(body).not.toContain('## Quellen')
    expect(body).not.toContain('oib-rl_4_ausgabe_mai_2023.pdf')
    expect(body).toContain('[1]')
    expect(body).toContain('[2]')
    expect([...numbers]).toEqual([1, 2])
  })

  test('leaves an answer without a sources section untouched', () => {
    const answer = 'Kurze Antwort ohne Quellenteil.'
    const split = splitAnswerBody(answer)
    expect(split.body).toBe(answer)
    expect(split.entries).toEqual([])
    expect(split.numbers.size).toBe(0)
  })

  test('anchor prefixes are per message so two answers never collide', () => {
    expect(answerSourceAnchorPrefix('m1')).not.toBe(answerSourceAnchorPrefix('m2'))
  })
})

describe('provenance selection', () => {
  const web = (i: number): CitationSource => ({
    id: `c${i}`,
    url: `https://host-${i}.example.com/a`,
    content: '',
    timestamp: new Date(0),
    isCited: true,
  })

  it('returns nothing when the turn carries no provenance at all', () => {
    expect(buildCitationModel({})).toEqual([])
  })

  it('prefers the sources the answer actually cited', () => {
    const cited = { ...web(1), isCited: true }
    const discovered = { ...web(2), isCited: false }
    const docs = buildCitationModel({ citations: [cited, discovered] })

    expect(docs).toHaveLength(2)
    expect(answerDocuments(docs).map((doc) => doc.url)).toEqual([cited.url])
  })

  it('falls back to every source when none carries the cited flag', () => {
    const docs = buildCitationModel({
      citations: [
        { ...web(1), isCited: undefined },
        { ...web(2), isCited: undefined },
      ],
    })
    expect(answerDocuments(docs)).toHaveLength(2)
  })

  it('deduplicates by URL', () => {
    const docs = buildCitationModel({
      citations: [web(1), { ...web(1), id: 'other' }],
    })
    expect(docs).toHaveLength(1)
  })

})

describe('a source known only from the written list', () => {
  it('still renders as the OIB document it is', () => {
    const [doc] = buildCitationModel({ entries: [writtenEntry(1, 9)] })

    expect(doc!.lane).toBe('building_law_oib')
    expect(doc!.kind).toBe('building_law')
    expect(doc!.tint).toBe('oib')
    expect(doc!.authority).toBe('OIB')
  })

  it('renders identically to the same document with a full structured wire', () => {
    const fromEntry = buildCitationModel({ entries: [writtenEntry(1, 5)] })[0]!
    const fromWire = buildCitationModel({ citations: [wireLocus(1, 5)] })[0]!

    expect([fromEntry.title, fromEntry.tint, fromEntry.authority, fromEntry.kind]).toEqual([
      fromWire.title,
      fromWire.tint,
      fromWire.authority,
      fromWire.kind,
    ])
  })
})

describe('merging is not fooled by empty values', () => {
  it('a whitespace-only collection never blocks the real one', () => {
    const blank: CitationSource = {
      id: 'a',
      content: 'x',
      timestamp: new Date(0),
      fileName: 'Plan.pdf',
      collection: '   ',
      citationKey: 'Plan.pdf, p.1',
      page: 1,
      isCited: true,
    }
    const real: CitationSource = { ...blank, id: 'b', collection: 'proj_1' }

    for (const order of [[blank, real], [real, blank]]) {
      const [doc] = buildCitationModel({ citations: order })
      expect(doc!.collection).toBe('proj_1')
    }
  })

  it('a whitespace-only citation key never blocks the real one', () => {
    const blank: CitationSource = {
      id: 'a',
      content: 'x',
      timestamp: new Date(0),
      fileName: 'Plan.pdf',
      collection: 'proj_1',
      citationKey: '   ',
      page: 1,
      isCited: true,
    }
    const real: CitationSource = { ...blank, id: 'b', citationKey: 'Plan.pdf, p.1' }

    const [doc] = buildCitationModel({ citations: [blank, real] })
    expect(doc!.loci[0]!.citationKey).toBe('Plan.pdf, p.1')
  })
})

describe('a model-written filename spelling never doubles a chip', () => {
  const WIRE_FILE = 'oib-rl_2_ausgabe_mai_2023.pdf'
  const wire = (number: number, page: number): CitationSource => ({
    id: `dbl-${number}`,
    content: `[KB] ${WIRE_FILE}, p.${page}`,
    timestamp: new Date(0),
    origin: 'kb',
    kind: 'building_law',
    lane: 'building_law_oib',
    title: 'OIB-Richtlinie 2, Ausgabe Mai 2023',
    citationKey: `${WIRE_FILE}, p.${page}`,
    collection: 'oib_knowledge',
    fileName: WIRE_FILE,
    page,
    number,
    isCited: true,
  })
  const written = (number: number, markdown: string): ReportSourceEntry => ({
    number,
    markdown,
    sourceKind: 'kb',
  })

  it('folds an extension-less written spelling into its wire document', () => {
    const docs = buildCitationModel({
      citations: [wire(1, 1), wire(3, 26)],
      entries: [
        written(1, '[KB] oib-rl-2 ausgabe mai 2023, p.1'),
        written(3, '[KB] oib-rl-2 ausgabe mai 2023, p.26'),
      ],
    })

    expect(docs).toHaveLength(1)
    expect(citationNumbers(docs[0]!)).toEqual([1, 3])
    expect(docs[0]!.loci).toHaveLength(2)
    expect(citedPages(docs[0]!)).toEqual([1, 26])
  })

  it('merges underscore/dash/case variants, with or without extension', () => {
    for (const spelling of [
      '[KB] oib-rl-2_ausgabe_mai_2023.pdf, p.1',
      '[KB] OIB-RL-2-AUSGABE-MAI-2023.PDF, p.1',
      '[KB] oib_rl_2_ausgabe_mai_2023, p.1',
    ]) {
      const docs = buildCitationModel({
        citations: [wire(1, 1)],
        entries: [written(1, spelling)],
      })
      expect(docs).toHaveLength(1)
      expect(citationNumbers(docs[0]!)).toEqual([1])
    }
  })

  it('keeps different pages of one document as one document with two loci', () => {
    const docs = buildCitationModel({
      citations: [wire(1, 1), wire(3, 26)],
      entries: [
        written(1, '[KB] oib-rl-2 ausgabe mai 2023, p.1'),
        written(3, '[KB] oib-rl-2 ausgabe mai 2023, p.26'),
      ],
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.loci).toHaveLength(2)
    expect(citedPages(docs[0]!)).toEqual([1, 26])
  })

  it('folds a title-decorated written line into its wire document', () => {
    for (const dash of ['–', '—', '-']) {
      const docs = buildCitationModel({
        citations: [wire(1, 1), wire(2, 26)],
        entries: [
          written(1, `[KB] OIB-Richtlinie 2 ${dash} oib-rl_2_ausgabe_mai_2023.pdf, p.1`),
          written(2, `[KB] OIB-Richtlinie 2 ${dash} oib-rl_2_ausgabe_mai_2023.pdf, p.26`),
        ],
      })

      expect(docs).toHaveLength(1)
      expect(docs[0]!.title).toBe('OIB-Richtlinie 2, Ausgabe Mai 2023')
      expect(citationNumbers(docs[0]!)).toEqual([1, 2])
      expect(citedPages(docs[0]!)).toEqual([1, 26])
    }
  })

  it('keeps a filename that genuinely contains a spaced dash when the wire spells it so', () => {
    const dashed: CitationSource = {
      ...wire(1, 4),
      id: 'dbl-dash',
      title: undefined,
      content: '[KB] Bescheid - Kopie.pdf, p.4',
      citationKey: 'Bescheid - Kopie.pdf, p.4',
      collection: 'project_x',
      fileName: 'Bescheid - Kopie.pdf',
      lane: 'project',
      kind: 'project',
    }
    const docs = buildCitationModel({
      citations: [dashed],
      entries: [written(1, '[KB] Bescheid - Kopie.pdf, p.4')],
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.fileName).toBe('Bescheid - Kopie.pdf')
    expect(docs[0]!.loci).toHaveLength(1)
  })

  it('a written [N] the wire already numbers joins that document, whatever it says', () => {
    const docs = buildCitationModel({
      citations: [wire(1, 1)],
      entries: [written(1, '[KB] irgendein-anderer-name.pdf, p.9')],
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.fileName).toBe(WIRE_FILE)
    expect(citedPages(docs[0]!)).toEqual([1])
  })

  it('a RIS source cited by URL is one chip even when the written URL differs', () => {
    const wireRis: CitationSource = {
      id: 'ris-6',
      content: '[RIS] Wiener Bautechnikverordnung 2023',
      timestamp: new Date(0),
      origin: 'ris',
      kind: 'building_law',
      lane: 'building_law_ris',
      laneLabel: 'Verordnung',
      title: 'Wiener Bautechnikverordnung 2023',
      url: 'https://ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000456',
      bindingStatus: 'binding',
      bindingNote: 'Macht die OIB-Richtlinien in Wien verbindlich.',
      number: 6,
      isCited: true,
    }
    const docs = buildCitationModel({
      citations: [wireRis],
      entries: [
        written(
          6,
          '[RIS] Wiener Bautechnikverordnung 2023 - https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000456&FassungVom=2024-01-01'
        ),
      ],
    })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.bindingNote).toBe('Macht die OIB-Richtlinien in Wien verbindlich.')
    expect(citationNumbers(docs[0]!)).toEqual([6])
  })

  it('a written line fills the page the wire left blank, and nothing more', () => {
    const pageless: CitationSource = { ...wire(1, 1), page: undefined, citationKey: WIRE_FILE }
    const docs = buildCitationModel({
      citations: [pageless],
      entries: [written(1, `[KB] ${WIRE_FILE}, p.7`)],
    })

    expect(docs).toHaveLength(1)
    expect(citedPages(docs[0]!)).toEqual([7])
  })

  it('without a wire number, a decorated line still finds its file by name', () => {
    const unnumbered: CitationSource = { ...wire(1, 1), number: undefined }
    const docs = buildCitationModel({
      citations: [unnumbered],
      entries: [written(1, '[KB] OIB-Richtlinie 2 – oib-rl_2_ausgabe_mai_2023.pdf, p.1')],
    })

    expect(docs).toHaveLength(1)
    expect(citationNumbers(docs[0]!)).toEqual([1])
  })

  it('without a wire number, never attaches a written line to a file it merely resembles', () => {
    const corpus: CitationSource = {
      id: 'dbl-c',
      content: '[KB] oib-rl_6_ausgabe_mai_2023.pdf, p.2',
      timestamp: new Date(0),
      origin: 'kb',
      kind: 'building_law',
      lane: 'building_law_oib',
      title: 'OIB-Richtlinie 6, Ausgabe Mai 2023',
      citationKey: 'oib-rl_6_ausgabe_mai_2023.pdf, p.2',
      collection: 'oib_knowledge',
      fileName: 'oib-rl_6_ausgabe_mai_2023.pdf',
      page: 2,
      number: undefined,
      isCited: true,
    }
    const docs = buildCitationModel({
      citations: [corpus],
      entries: [written(1, '[KB] OIB-Richtlinie 6 Kommentar.pdf, p.9')],
    })

    expect(docs).toHaveLength(2)
  })
})
