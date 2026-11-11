/**
 * @vitest-environment node
 *
 * The ordering trap, closed in the kit (ADR-0165, "Texts are attached in the
 * request"): a manifestation that names a base-corpus file is a problem unless
 * the corpus holds that file, and a corpus that cannot answer is a problem
 * too. So no request is submitted, approved and published before its text is
 * there, which is what used to fail the indexing run after the publish.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const corpus = vi.hoisted(() => ({ files: [] as { fileName: string; state: string }[], answers: true }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseStatus: async () => {
    if (!corpus.answers) throw new Error('Knowledge backend unreachable')
    return { files: corpus.files }
  },
}))
vi.mock('./source-checks', () => ({ sourceChecksOf: async () => new Map() }))

import { checksOutsideKit, textChecksOf } from './text-checks'
import { type KnownCapture, type KnownRecord, validateProposal } from './validate'
import { proposedRecordSchema } from './wire'

const CAPTURE = '6f0c1a7e-2b7d-4c55-9a3e-6d1f0b2a9c11'
const CAPTURES = new Map<string, KnownCapture>([[CAPTURE, { text: 'OIB-Richtlinie 1, Ausgabe April 2019, herausgegeben vom OIB', basis: 'fetched' }]])
const KNOWN = new Map<string, KnownRecord>([['edition:oib-rl-1-2019', { type: 'edition', countryId: 'AT' }]])

const manifestation = (corpusFile: string | null) =>
  proposedRecordSchema.parse({
    type: 'manifestation',
    key: 'oib-rl-1-2019-text',
    editionKey: 'oib-rl-1-2019',
    licenceClass: 'public_open',
    corpusFile,
    citations: [{ captureId: CAPTURE, quote: 'herausgegeben vom OIB' }],
  })

/** The kit as the service runs it: the outside checks first, then the pure proposal check. */
async function kit(corpusFile: string | null) {
  const records = [manifestation(corpusFile)]
  return validateProposal(records, 'AT', KNOWN, CAPTURES, [], await checksOutsideKit(records))
}

describe('a manifestation’s text is in the base corpus before the record is written', () => {
  beforeEach(() => {
    corpus.files = [{ fileName: 'oib-rl-1-2019.pdf', state: 'ingested' }]
    corpus.answers = true
  })

  it('passes a text the corpus holds, and a manifestation that names none (positive control)', async () => {
    expect(await kit('oib-rl-1-2019.pdf')).toEqual([])
    expect(await kit(null)).toEqual([])
  })

  it('refuses a file nobody uploaded, pointing at corpusFile and at the operations that attach it', async () => {
    expect(await kit('never-uploaded.pdf')).toMatchObject([
      {
        code: 'KC-1',
        recordId: 'manifestation:oib-rl-1-2019-text',
        pointer: '/corpusFile',
        detail: 'names never-uploaded.pdf, which the base corpus does not hold.',
        hint: expect.stringMatching(/platform-knowledge-text-import.*platform-knowledge-text-upload/),
      },
    ])
  })

  it('does not count a file whose bytes are gone', async () => {
    corpus.files = [{ fileName: 'oib-rl-1-2019.pdf', state: 'removed' }]
    expect(await kit('oib-rl-1-2019.pdf')).toMatchObject([{ code: 'KC-1', pointer: '/corpusFile' }])
  })

  it('fails closed when the corpus does not answer', async () => {
    corpus.answers = false
    expect(await kit('oib-rl-1-2019.pdf')).toMatchObject([{ code: 'KC-1', pointer: '/corpusFile', detail: expect.stringContaining('could not be checked') }])
  })

  it('fails closed when nobody asked the corpus at all', () => {
    // The pure kit without the outside check: unknown is a problem, never a pass.
    expect(validateProposal([manifestation('oib-rl-1-2019.pdf')], 'AT', KNOWN, CAPTURES)).toMatchObject([
      { code: 'KC-1', pointer: '/corpusFile', detail: expect.stringContaining('was not checked') },
    ])
    expect(validateProposal([manifestation(null)], 'AT', KNOWN, CAPTURES)).toEqual([])
  })

  it('asks the corpus only when a record names a file', async () => {
    corpus.answers = false
    expect(await textChecksOf([manifestation(null)])).toEqual(new Map())
  })
})
