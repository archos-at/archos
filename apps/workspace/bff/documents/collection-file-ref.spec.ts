/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { collectionDocumentsUrl, collectionFileRef, collectionFileUrl, purgeIngestedChunks } from './collection-file-ref'

const row = {
  collectionName: 'proj_abc',
  filename: 'brandschutz-gutachten-2026-08-20.pdf',
  publishedVersionId: null,
} as const

const publishedAgent = {
  collectionName: 'proj_abc',
  filename: 'piloti/doc_1/aktenvermerk-2026-09-01.md',
  authoredBy: 'agent',
  publishedVersionId: 'ver_2',
} as const

describe('collectionFileRef', () => {
  it('names the pair for a row a person uploaded', () => {
    expect(collectionFileRef({ ...row, authoredBy: 'user' })).toMatchObject({
      collectionName: 'proj_abc',
      filename: 'brandschutz-gutachten-2026-08-20.pdf',
    })
  })

  it('names the pair for a person’s row whatever its version pointer says', () => {
    expect(collectionFileRef({ ...row, authoredBy: 'user', publishedVersionId: 'ver_1' })).not.toBeNull()
    expect(collectionFileRef({ ...row, authoredBy: 'user', publishedVersionId: null })).not.toBeNull()
  })

  it('refuses a row a machine wrote, however ordinary the pair looks', () => {
    expect(collectionFileRef({ ...row, authoredBy: 'agent' })).toBeNull()
  })

  it('names the pair for a PUBLISHED agent document under its namespace', () => {
    expect(collectionFileRef(publishedAgent)).toMatchObject({
      collectionName: 'proj_abc',
      filename: 'piloti/doc_1/aktenvermerk-2026-09-01.md',
    })
  })

  it('refuses an agent draft under the namespace: nothing was ever published', () => {
    expect(collectionFileRef({ ...publishedAgent, publishedVersionId: null })).toBeNull()
  })

  it('refuses a published agent row OUTSIDE the namespace', () => {
    expect(
      collectionFileRef({ ...publishedAgent, filename: 'brandschutz-gutachten-2026-08-20.pdf' }),
    ).toBeNull()
  })

  it('is not fooled by a name that merely mentions the namespace', () => {
    expect(collectionFileRef({ ...publishedAgent, filename: 'piloti-bericht.md' })).toBeNull()
    expect(collectionFileRef({ ...publishedAgent, filename: 'x/piloti/doc_1/a.md' })).toBeNull()
  })
})

describe('the URL builders', () => {
  const ref = collectionFileRef({ ...row, authoredBy: 'user' })
  if (!ref) throw new Error('unreachable: the fixture row is human-authored')

  it('builds the collection-level documents endpoint', () => {
    expect(collectionDocumentsUrl('http://backend:8000', ref)).toBe(
      'http://backend:8000/v1/collections/proj_abc/documents',
    )
  })

  it('builds a per-file endpoint from the same ref', () => {
    expect(collectionFileUrl('http://backend:8000', ref, '/visual-details')).toBe(
      'http://backend:8000/v1/collections/proj_abc/documents/brandschutz-gutachten-2026-08-20.pdf/visual-details',
    )
  })

  it('percent-encodes both segments, so a name with a slash cannot leave its collection', () => {
    const awkward = collectionFileRef({
      collectionName: 'proj_a b',
      filename: 'Schnitt A-A/EG.pdf',
      authoredBy: 'user',
      publishedVersionId: null,
    })
    if (!awkward) throw new Error('unreachable: the fixture row is human-authored')

    expect(collectionFileUrl('http://backend:8000', awkward, '/tags')).toBe(
      'http://backend:8000/v1/collections/proj_a%20b/documents/Schnitt%20A-A%2FEG.pdf/tags',
    )
  })
})

describe('purgeIngestedChunks — reversible unless said otherwise', () => {
  const ref = collectionFileRef({
    collectionName: 'proj_abc',
    filename: 'EG_Grundriss_Index_B.pdf',
    authoredBy: 'user',
    publishedVersionId: null,
  })!
  const fetchSpy = vi.fn()

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchSpy.mockReset()
  })

  const bodyOf = () => JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as unknown

  it('asks for a reversible purge by default: the backend keeps the Fassung links a person made', async () => {
    vi.stubGlobal('fetch', fetchSpy.mockResolvedValue(new Response('{}', { status: 200 })))

    await expect(purgeIngestedChunks('http://backend:8000', ref, 1000)).resolves.toBe(true)

    expect(fetchSpy.mock.calls[0][0]).toBe('http://backend:8000/v1/collections/proj_abc/documents')
    expect(bodyOf()).toEqual({ file_ids: ['EG_Grundriss_Index_B.pdf'] })
  })

  it('says permanent when the document will not come back, so every link to it is cleared', async () => {
    vi.stubGlobal('fetch', fetchSpy.mockResolvedValue(new Response('{}', { status: 200 })))

    await purgeIngestedChunks('http://backend:8000', ref, 1000, { permanent: true })

    expect(bodyOf()).toEqual({ file_ids: ['EG_Grundriss_Index_B.pdf'], permanent: true })
  })

  it('does not confirm a purge the backend answered 200 but listed as failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failed = JSON.stringify({ successful: [], not_found: [], failed: [{ file_id: 'x', error: 'boom' }], total_deleted: 0 })
    vi.stubGlobal('fetch', fetchSpy.mockResolvedValue(new Response(failed, { status: 200 })))
    await expect(purgeIngestedChunks('http://backend:8000', ref, 1000)).resolves.toBe(false)
  })

  it('counts a file with nothing indexed as purged: nothing is left', async () => {
    const none = JSON.stringify({ successful: [], not_found: ['EG_Grundriss_Index_B.pdf'], failed: [], total_deleted: 0 })
    vi.stubGlobal('fetch', fetchSpy.mockResolvedValue(new Response(none, { status: 200 })))
    await expect(purgeIngestedChunks('http://backend:8000', ref, 1000)).resolves.toBe(true)
  })
})
