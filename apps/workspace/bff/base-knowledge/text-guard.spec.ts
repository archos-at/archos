import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./store/repository', () => ({ copyForDocument: vi.fn(), documentsWithEntries: vi.fn() }))

import { copyForDocument, documentsWithEntries } from './store/repository'
import { copyMarkForIngest, heldAmong, isTextHeld, licenceOfDocument } from './text-guard'

const ATTESTED = { aiProcessingAttestedBy: 'u', aiProcessingAttestedAt: '2026-11-01T00:00:00.000Z' }

beforeEach(() => {
  vi.mocked(copyForDocument).mockReset()
})

describe('the licence lookup by document id', () => {
  it('names a licensed copy and whether its office stated the AI processing', async () => {
    vi.mocked(copyForDocument).mockResolvedValue({
      licenceClass: 'licensed',
      editionId: 'ed-1',
      terms: {},
      confirmed: false,
    })
    expect(await licenceOfDocument('org_1', 'doc-1')).toEqual({
      licenceClass: 'licensed',
      licensed: true,
      aiProcessingAttested: false,
      quoteMaxChars: 500,
      confirmed: false,
      held: true,
      editionId: 'ed-1',
    })
  })

  it('answers null for a document that is no base-knowledge copy', async () => {
    vi.mocked(copyForDocument).mockResolvedValue(null)
    expect(await licenceOfDocument('org_1', 'doc-1')).toBeNull()
  })
})

describe('what the ingest path asks', () => {
  it('stamps only a confirmed copy, with its attestation and cap', async () => {
    vi.mocked(copyForDocument).mockResolvedValue({
      licenceClass: 'licensed',
      editionId: 'ed-1',
      terms: ATTESTED,
      confirmed: true,
    })
    expect(await copyMarkForIngest('org_1', 'doc-1')).toEqual({
      licenceClass: 'licensed',
      aiProcessingAttested: true,
      quoteMaxChars: 500,
      editionId: 'ed-1',
    })
    vi.mocked(copyForDocument).mockResolvedValue({
      licenceClass: 'licensed',
      editionId: 'ed-1',
      terms: ATTESTED,
      confirmed: false,
    })
    expect(await copyMarkForIngest('org_1', 'doc-1')).toBeNull()
  })

  it('keeps the text out when the records cannot be read', async () => {
    vi.mocked(copyForDocument).mockRejectedValue(new Error('down'))
    expect(await isTextHeld('org_1', 'doc-1')).toBe(true)
  })
})

describe('whose text is held', () => {
  it('holds every copy until a person confirms it, whatever its class', async () => {
    vi.mocked(copyForDocument).mockResolvedValue({
      licenceClass: 'public_open',
      editionId: 'ed-1',
      terms: {},
      confirmed: false,
    })
    expect(await isTextHeld('org_1', 'doc-1')).toBe(true)
  })

  it('releases a confirmed public copy and a confirmed attested one, and holds a confirmed unattested licensed one', async () => {
    vi.mocked(copyForDocument).mockResolvedValueOnce({
      licenceClass: 'public_open',
      editionId: 'ed-1',
      terms: {},
      confirmed: true,
    })
    expect(await isTextHeld('org_1', 'doc-1')).toBe(false)
    vi.mocked(copyForDocument).mockResolvedValueOnce({
      licenceClass: 'licensed',
      editionId: 'ed-1',
      terms: ATTESTED,
      confirmed: true,
    })
    expect(await isTextHeld('org_1', 'doc-1')).toBe(false)
    vi.mocked(copyForDocument).mockResolvedValueOnce({
      licenceClass: 'licensed',
      editionId: 'ed-1',
      terms: {},
      confirmed: true,
    })
    expect(await isTextHeld('org_1', 'doc-1')).toBe(true)
  })

  it('names the held copies of a batch, and holds the whole batch when the records cannot be read', async () => {
    vi.mocked(documentsWithEntries).mockResolvedValue(['doc-2'])
    vi.mocked(copyForDocument).mockResolvedValue({
      licenceClass: 'licensed',
      editionId: 'ed-1',
      terms: {},
      confirmed: false,
    })
    expect(await heldAmong('org_1', ['doc-1', 'doc-2'])).toEqual(new Set(['doc-2']))
    vi.mocked(documentsWithEntries).mockRejectedValue(new Error('down'))
    expect(await heldAmong('org_1', ['doc-1', 'doc-2'])).toEqual(new Set(['doc-1', 'doc-2']))
  })
})
