import { render, screen, within } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import type { LawMap } from '@/lib/base-knowledge/platform/law-map'
import type { RevisionView } from '@/lib/base-knowledge/platform/wire'
import { namer, RecordBody } from './law-map-record'

/**
 * A record the outline has no branch for reads in words (country-onboarding-ux.md, B): a source says where it
 * fetches from, its licence with the attribution, whether it is watched, the documents it may fetch and what its
 * test proves; a test question says what it asks and what a right answer says. The stored fields stay folded.
 */

const revision = (type: string, recordId: string, body: Record<string, unknown>): RevisionView =>
  ({
    revisionId: `rev-${recordId}`,
    recordId,
    type,
    createdBy: 'author',
    citations: [],
    claims: Object.entries(body).map(([path, value]) => ({ path, value, decision: null })),
  }) as unknown as RevisionView

const MAP: LawMap = {
  countryId: 'XA',
  territories: new Map([['XA-1', { id: 'XA-1', name: 'Nordland', kind: 'state', parentIds: ['XA'] }]]) as unknown as LawMap['territories'],
  rootIds: ['XA'],
  topics: [{ workId: 'work:mc-2', designation: 'MC 2', title: 'Fire' }],
  editions: new Map([['edition:mc-2-2023', { id: 'edition:mc-2-2023', workId: 'work:mc-2', label: '2023', issuedOn: null, text: null, review: 'open' }]]) as unknown as LawMap['editions'],
  statutes: [],
  statements: [],
  otherWorks: [],
  looseTexts: [],
}

const SOURCE = revision('source', 'source:xa-guidelines', {
  title: 'Model Code guidelines',
  territoryId: 'XA',
  protocol: 'web_document',
  format: 'pdf_document',
  hosts: ['www.guidelines.xa.example'],
  dataFlow: 'public_only',
  monitorKind: 'none',
  monitorIntervalHours: 24,
  licence: 'public_open',
  config: {
    id: 'xa-guidelines',
    terms: { url: 'https://www.guidelines.xa.example/terms', licence: 'public_open', attribution: '© Institute of Building', checked: '2026-11-01' },
    access: {
      documents: [
        { id: 'mc-2', url: 'https://www.guidelines.xa.example/mc-2.pdf', title: 'MC 2' },
        { id: 'mc-3', url: 'https://www.guidelines.xa.example/mc-3.pdf', title: 'MC 3' },
      ],
    },
    engine: {},
    fixtures: [{ name: 'mc-2-reads', operation: 'document', args: { id: 'mc-2' }, responses: { 'https://www.guidelines.xa.example/mc-2.pdf': { capture_id: 'c1' } }, expect: { min_passages: 30 } }],
  },
})

const CASE = revision('golden_case', 'golden_case:nordland-escape', {
  question: 'How long may the escape route to the stair be?',
  language: 'en',
  context: { territoryId: 'XA-1', facts: { storeys: 4 }, referenceDate: null, note: null },
  expected: {
    values: [{ label: 'longest escape route', anyOf: ['40 m'], grounding: 'text' }],
    edition: { editionKey: 'mc-2-2023', anyOf: ['MC 2 2023'], role: null, grounding: 'records' },
    citations: [],
  },
  mustNot: [{ kind: 'source', id: 'web-copy', sourceKinds: ['web'], naming: [] }],
  tags: [],
})

const body = (one: RevisionView) => render(<RecordBody revision={one} name={namer(MAP, [SOURCE, CASE])} />)

describe('RecordBody', () => {
  test('says a source in words: its host, licence and attribution, monitoring, documents and test', () => {
    body(SOURCE)
    const shown = screen.getByTestId('record-source:xa-guidelines')
    expect(shown).toHaveTextContent('Fetched from www.guidelines.xa.example')
    expect(shown).toHaveTextContent('Licence: public, free to reuse · “© Institute of Building” · terms')
    expect(shown).toHaveTextContent('Monitoring: off')
    expect(within(shown).getByRole('link', { name: 'MC 3' })).toHaveAttribute('href', 'https://www.guidelines.xa.example/mc-3.pdf')
    expect(shown).toHaveTextContent('Test: MC 2 reads with ≥ 30 passages')
    // The configuration is no first read.
    expect(shown).not.toHaveTextContent('capture_id')
  })

  test('keeps the stored record behind "Technical details"', async () => {
    const user = userEvent.setup()
    body(SOURCE)
    expect(screen.queryByText(/"capture_id"/)).not.toBeInTheDocument()
    await user.click(screen.getByTestId('technical-source:xa-guidelines'))
    expect(screen.getByText(/"capture_id": "c1"/)).toBeInTheDocument()
  })

  test('says a test question in words: the question, its site, what a right answer says and what it must not do', () => {
    body(CASE)
    const shown = screen.getByTestId('record-golden_case:nordland-escape')
    expect(shown).toHaveTextContent('How long may the escape route to the stair be?')
    expect(shown).toHaveTextContent('Asked for: Nordland')
    expect(shown).toHaveTextContent('Facts: storeys = 4')
    expect(shown).toHaveTextContent('longest escape route: “40 m”')
    expect(shown).toHaveTextContent('Rests on: MC 2 · 2023 (“MC 2 2023”)')
    expect(shown).toHaveTextContent('Must not: cite a source of kind web')
  })

  test('names a text by its work and edition, never by its record id', () => {
    const name = namer(MAP, [
      revision('work', 'work:oib-rl-1-erlaeuterungen', { kind: 'model_code', title: 'Erläuternde Bemerkungen zu OIB-Richtlinie 1' }),
      revision('edition', 'edition:oib-rl-1-erlaeuterungen-2023', { workId: 'work:oib-rl-1-erlaeuterungen', label: 'Ausgabe Mai 2023' }),
      revision('manifestation', 'manifestation:oib-rl-1-erlaeuterungen-2023-text', { editionId: 'edition:oib-rl-1-erlaeuterungen-2023', corpusFile: 'oib-rl-1-erlaeuterungen-2023-text.pdf' }),
      revision('manifestation', 'manifestation:elsewhere-text', { editionId: 'edition:released-before', corpusFile: 'elsewhere.pdf' }),
    ])
    expect(name('manifestation:oib-rl-1-erlaeuterungen-2023-text')).toBe('Erläuternde Bemerkungen zu OIB-Richtlinie 1 · Ausgabe Mai 2023')
    expect(name('edition:mc-2-2023')).toBe('MC 2 · 2023')
    // A text for an edition released before this request: its file, still no id.
    expect(name('manifestation:elsewhere-text')).toBe('elsewhere.pdf')
  })
})
