// @disk-inputs: ../../tests/fixtures/citation_pipeline/wire_sources.json
/**
 * @vitest-environment node
 */
/**
 * Cross-language contract: what a citation carries for its line, on every hop.
 *
 * The agent resolves a cited passage's edition, role, route and dates from the
 * knowledge records (`citations/roles.py` `role_fields`) and
 * `source_entry_to_wire` puts them on the citation. From there three readers
 * hold them: the live normalizer (`citationFromWire`), the browser's stored
 * payload (`encodeCitations` / `decodeCitations`) and the BFF's
 * (`encodeBackendSources`, the only one a research report and a turn whose
 * client was gone ever pass through). Each of the three ENUMERATES fields, so a
 * field one of them does not know is dropped in silence, and a citation with no
 * status line is a supported outcome everywhere: nothing fails, the line is
 * simply never there. Before this spec the agent emitted `role`, `role_qualifier`
 * and `edition_id` and no client read any of them.
 *
 * Both sides assert against the same checked-in fixture
 * (`tests/fixtures/citation_pipeline/wire_sources.json`); its Python counterpart,
 * `test_wire_sources_fixture_matches_the_serializer`, proves the fixture is
 * exactly what the serializer emits. So a key the agent adds and this tier does
 * not name fails here, by name.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { encodeBackendSources } from '@/lib/conversations/agent-answer-metadata'
import { CITATION_LINE_KEYS, citationLineOf } from '@/shared/citation-line'
import { citationFromWire } from '../wire-citation'
import type { WireCitationSource } from '../../types'
import { buildCitationModel, decodeCitations, encodeCitations, resolveCitationTarget } from './index'

const HERE = dirname(fileURLToPath(import.meta.url))
const WIRE_SOURCES = JSON.parse(
  readFileSync(resolve(HERE, '../../../../../../../tests/fixtures/citation_pipeline/wire_sources.json'), 'utf-8')
) as Array<WireCitationSource & Record<string, unknown>>

/** Every key the serializer emits that is not a line field: what the three readers already enumerate. */
const KNOWN_SOURCE_KEYS = new Set([
  'number',
  'document_id',
  'content',
  'title',
  'citation_key',
  'collection',
  'shelf',
  'source_type',
  'tool',
  'url',
  'origin',
  'kind',
  'lane',
  'lane_label',
  'binding_status',
  'file_name',
  'page',
  'clause',
  'score',
  'snippet',
  'regions',
  'page_end',
  'project',
])

const [edition] = WIRE_SOURCES
const lineOfFixture = Object.fromEntries(CITATION_LINE_KEYS.filter((key) => key in edition).map((key) => [key, edition[key]]))

describe('the citation line the agent emits', () => {
  test('every key on the wire is one this tier names', () => {
    const named = new Set<string>([...KNOWN_SOURCE_KEYS, ...CITATION_LINE_KEYS])
    for (const source of WIRE_SOURCES) {
      expect(Object.keys(source).filter((key) => !named.has(key)), JSON.stringify(source.file_name)).toEqual([])
    }
  })

  test('the fixture carries a line, so nothing below passes over an absent value', () => {
    expect(Object.keys(lineOfFixture).sort()).toEqual(
      [
        'as_of',
        'designation',
        'edition_id',
        'edition_label',
        'freshness',
        'language',
        'last_checked_at',
        'public_url',
        'role',
        'role_labels',
        'role_since',
        'route',
        'text_status',
        'work_id',
      ].sort()
    )
  })

  test('the schema keeps every field the serializer wrote, as written', () => {
    // A field the schema found malformed would be dropped here and the two would differ.
    expect(citationLineOf(edition)).toEqual(lineOfFixture)
  })

  test('the live normalizer carries the line onto the citation', () => {
    expect(citationFromWire(edition).line).toEqual(lineOfFixture)
  })

  test('a source no record reaches carries no line at all', () => {
    expect(citationFromWire(WIRE_SOURCES[1]).line).toBeUndefined()
  })

  test('the browser’s stored payload gives the line back as it was shown', () => {
    const stored = encodeCitations(WIRE_SOURCES.map((wire) => citationFromWire(wire)))
    const restored = decodeCitations(JSON.parse(JSON.stringify(stored)), new Date('2026-11-11T09:00:00Z'))
    expect(restored?.[0]?.line).toEqual(lineOfFixture)
    expect(restored?.[1]?.line).toBeUndefined()
  })

  test('the BFF’s stored payload keeps it, for an answer no browser was there to store', () => {
    const stored = encodeBackendSources(WIRE_SOURCES)
    expect(citationLineOf(stored?.sources[0])).toEqual(lineOfFixture)
    expect(decodeCitations(stored, new Date('2026-11-11T09:00:00Z'))?.[0]?.line).toEqual(lineOfFixture)
  })

  test('one malformed field is dropped on its own, never the line or the source', () => {
    const bent = { ...edition, role_since: 'June 2022', public_url: 'http://insecure.example/x', route: { designation: 'no work' } }
    // What a stored row or an older pod might hold: the wrong type for a field, not the declared one.
    const line = citationFromWire(bent as unknown as WireCitationSource).line
    expect(line).toEqual(
      Object.fromEntries(Object.entries(lineOfFixture).filter(([key]) => !['role_since', 'public_url', 'route'].includes(key)))
    )
  })
})

describe('a passage cited by its key opens where its records say it is published', () => {
  const law: WireCitationSource = {
    citation_key: 'Building Act of Nordland, § 12',
    title: 'Building Act of Nordland',
    kind: 'building_law',
    shelf: 'base',
    work_id: 'work:building-act',
    public_url: 'https://gazette.xa.example/code?Law=77',
  }
  const documentOf = (wire: WireCitationSource) => {
    const [built] = buildCitationModel({ citations: [citationFromWire(wire, { isCited: true })] })
    if (!built) throw new Error('fixture produced no document')
    return built
  }

  test('with no file and no URL of its own, the public address is the target', () => {
    expect(resolveCitationTarget(documentOf(law))).toEqual({ kind: 'url', url: 'https://gazette.xa.example/code?Law=77' })
  })

  test('without one it resolves to nothing, as before', () => {
    const { public_url: _unused, ...bare } = law
    expect(resolveCitationTarget(documentOf(bare)).kind).toBe('info')
  })

  test('a corpus copy the reader may open wins over the publisher’s page', () => {
    const target = resolveCitationTarget(documentOf(edition), { baseCorpusFiles: ['oib-rl_2_ausgabe_mai_2023.pdf'] })
    expect(target).toMatchObject({ kind: 'document', document: { type: 'base' }, page: 12 })
  })
})
