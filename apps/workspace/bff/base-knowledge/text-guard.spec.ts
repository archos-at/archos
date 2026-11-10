import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./store/repository', () => ({ copyForDocument: vi.fn() }))

import { copyForDocument } from './store/repository'
import { copyMarkForIngest, isMetadataOnlyCopy, licenceOfDocument } from './text-guard'

const ATTESTED = { aiProcessingAttestedBy: 'u', aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z' }

beforeEach(() => {
  vi.mocked(copyForDocument).mockReset()
})

describe('the licence lookup by document id', () => {
  it('names a licensed copy and whether its office stated the AI processing', async () => {
    vi.mocked(copyForDocument).mockResolvedValue({ licenceClass: 'licensed', editionId: 'ed-1', terms: {}, confirmed: false })
    expect(await licenceOfDocument('org_1', 'doc-1')).toEqual({
      licenceClass: 'licensed',
      licensed: true,
      aiProcessingAttested: false,
      quoteMaxChars: 500,
      confirmed: false,
    })
  })

  it('answers null for a document that is no base-knowledge copy', async () => {
    vi.mocked(copyForDocument).mockResolvedValue(null)
    expect(await licenceOfDocument('org_1', 'doc-1')).toBeNull()
  })
})

describe('what the ingest path asks', () => {
  it('stamps only a confirmed copy, with its attestation and cap', async () => {
    vi.mocked(copyForDocument).mockResolvedValue({ licenceClass: 'licensed', editionId: 'ed-1', terms: ATTESTED, confirmed: true })
    expect(await copyMarkForIngest('org_1', 'doc-1')).toEqual({
      licenceClass: 'licensed',
      aiProcessingAttested: true,
      quoteMaxChars: 500,
      editionId: 'ed-1',
    })
    vi.mocked(copyForDocument).mockResolvedValue({ licenceClass: 'licensed', editionId: 'ed-1', terms: ATTESTED, confirmed: false })
    expect(await copyMarkForIngest('org_1', 'doc-1')).toBeNull()
  })

  it('keeps the text out when the records cannot be read', async () => {
    vi.mocked(copyForDocument).mockRejectedValue(new Error('down'))
    expect(await isMetadataOnlyCopy('org_1', 'doc-1')).toBe(true)
  })
})
