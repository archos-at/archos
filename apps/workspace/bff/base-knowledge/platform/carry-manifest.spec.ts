// @disk-inputs: config/knowledge-releases/**
/**
 * @vitest-environment node
 *
 * The bundles the promotion carries (ADR-0181): the committed manifest is one this build reads, and each bundle
 * file beside it is the one it names, so a stale or edited bundle fails here and not in production's carry Job.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { CarryRefused, checkCarryOrder, parseManifest, sha256Hex, verifiedBundle } from './carry-manifest'

vi.mock('server-only', () => ({}))

const DIR = join(process.cwd(), 'config', 'knowledge-releases')

const bundle = {
  format: 'knowledge-release/1',
  countryId: 'XB',
  releaseSeq: 7,
  records: [{ type: 'territory', id: 'XB', kind: 'union', name: 'Union of Xanadu and Beyond', citations: [] }],
  captures: [],
  texts: [],
  requires: [],
}
const json = Buffer.from(JSON.stringify(bundle))
const entry = { file: 'xb-7.json.gz', countryId: 'XB', seq: 7, sha256: sha256Hex(json), records: 1, captures: 0, texts: {} }

describe('the committed carry manifest', () => {
  const manifest = parseManifest(JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')))

  it('names bundles from dev, each verified against its file', () => {
    expect(manifest.sourceDeployment).toBe('dev')
    for (const carried of manifest.bundles) {
      expect(verifiedBundle(carried, readFileSync(join(DIR, carried.file))).countryId).toBe(carried.countryId)
    }
  })
})

describe('a carried bundle', () => {
  it('is the one the manifest names, by its uncompressed sha256 and its facts', () => {
    expect(verifiedBundle(entry, gzipSync(json)).countryId).toBe('XB')
    expect(() => verifiedBundle({ ...entry, sha256: '0'.repeat(64) }, gzipSync(json))).toThrow(CarryRefused)
    expect(() => verifiedBundle({ ...entry, seq: 8 }, gzipSync(json))).toThrow(/release seq 7; the manifest names 8/)
    expect(() => verifiedBundle(entry, json)).toThrow(/not a gzip file/)
  })

  it('comes after the countries it requires', () => {
    expect(() => checkCarryOrder([{ countryId: 'XB', requires: [] }, { countryId: 'XA', requires: ['XB'] }])).not.toThrow()
    expect(() => checkCarryOrder([{ countryId: 'XA', requires: ['XB'] }, { countryId: 'XB', requires: [] }])).toThrow(/list XB first/)
  })

  it('appears once per country', () => {
    expect(() => parseManifest({ format: 'knowledge-carry/1', sourceDeployment: 'dev', bundles: [entry, entry] })).toThrow(/a country twice/)
  })
})
