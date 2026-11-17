/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

vi.mock('server-only', () => ({}))

const send = vi.fn()
vi.mock('@/lib/s3', async () => {
  const actual = await vi.importActual<typeof import('@/lib/s3')>('@/lib/s3')
  return {
    ...actual,
    s3Client: { send: (...args: unknown[]) => send(...args) },
  }
})

vi.mock('@/lib/storage/bucket', () => ({
  resolveDocumentBucket: (bucket: string | null) => bucket ?? 'grid-documents',
}))

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

const deleteBimDerivedObjects = vi.fn()
vi.mock('@/lib/bim/service', () => ({
  deleteBimDerivedObjects: (...args: unknown[]) => deleteBimDerivedObjects(...args),
}))

const listSessionDocumentsForCleanup = vi.fn()
const deleteSessionDocumentsByIds = vi.fn()
vi.mock('./repository', () => ({
  listSessionDocumentsForCleanup: (...args: unknown[]) => listSessionDocumentsForCleanup(...args),
  deleteSessionDocumentsByIds: (...args: unknown[]) => deleteSessionDocumentsByIds(...args),
  SESSION_DOCUMENT_LIST_LIMIT: 100,
}))

import type { Document } from '@/lib/db/schema/documents'
import { deleteDocumentObjects } from '@/lib/documents/object-cleanup'
import { deleteSessionCollection, purgeCollectionChunks, purgeSessionDocuments } from './cleanup'
import { collectionFileRef } from '@/lib/documents/collection-file-ref'

const CONVERSATION_ID = 's_11111111-2222-3333-4444-555555555555'
const ORG_ID = 'org_1'

function sessionDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    organizationId: ORG_ID,
    conversationId: CONVERSATION_ID,
    scope: 'session',
    authoredBy: 'user',
    filename: 'brandschutz.pdf',
    collectionName: CONVERSATION_ID,
    storageKey: `org/${ORG_ID}/session/${CONVERSATION_ID}/doc/doc-1/brandschutz.pdf`,
    storageBucket: 'grid-org-org1-abc',
    ...overrides,
  } as unknown as Document
}

function stubFetch(response: { ok: boolean; status?: number } | Error): void {
  vi.stubGlobal(
    'fetch',
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue({ ok: response.ok, status: response.status ?? (response.ok ? 200 : 500) }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  send.mockResolvedValue({})
  deleteBimDerivedObjects.mockResolvedValue(undefined)
  deleteSessionDocumentsByIds.mockResolvedValue(undefined)
  stubFetch({ ok: true })
})

describe('deleteDocumentObjects', () => {
  it('reports success once the object, its thumbnail, its rendition and its BIM derivatives are gone', async () => {
    const result = await deleteDocumentObjects(sessionDoc())

    expect(result).toEqual({ ok: true })
    const commands = send.mock.calls.map(([command]) => command)
    const keys = commands
      .filter((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand)
      .map((command) => command.input.Key)
    expect(keys).toEqual([
      `org/${ORG_ID}/session/${CONVERSATION_ID}/doc/doc-1/brandschutz.pdf`,
      `org/${ORG_ID}/session/${CONVERSATION_ID}/doc/doc-1/_thumb.jpg`,
      `org/${ORG_ID}/session/${CONVERSATION_ID}/doc/doc-1/_render.pdf`,
    ])
    const listed = commands.find(
      (command): command is ListObjectsV2Command => command instanceof ListObjectsV2Command,
    )
    expect(listed?.input.Prefix).toBe(`org/${ORG_ID}/session/${CONVERSATION_ID}/doc/doc-1/_img/`)
    expect(deleteBimDerivedObjects).toHaveBeenCalled()
  })

  it('reports FAILURE when SeaweedFS refuses the delete', async () => {
    send.mockRejectedValueOnce(new Error('connection reset'))

    const result = await deleteDocumentObjects(sessionDoc())

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('connection reset')
  })

  it('reports FAILURE when the thumbnail cannot be removed', async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('thumb 503'))

    const result = await deleteDocumentObjects(sessionDoc())

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('thumb 503')
  })

  it('reports FAILURE when the BIM derivatives cannot be swept', async () => {
    deleteBimDerivedObjects.mockRejectedValue(new Error('list timed out'))

    const result = await deleteDocumentObjects(sessionDoc())

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('list timed out')
  })

  it('treats an object that is already gone as success', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }))

    await expect(deleteDocumentObjects(sessionDoc())).resolves.toEqual({ ok: true })
  })

  it('is a no-op success for a row that names no object', async () => {
    await expect(deleteDocumentObjects(sessionDoc({ storageKey: '' }))).resolves.toEqual({ ok: true })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('purgeCollectionChunks', () => {
  const ref = (filename: string) => {
    const value = collectionFileRef({
      collectionName: CONVERSATION_ID,
      filename,
      authoredBy: 'user',
      publishedVersionId: null,
    })
    if (!value) throw new Error('fixture is not a user-authored row')
    return value
  }

  it('succeeds on a 2xx', async () => {
    await expect(purgeCollectionChunks(CONVERSATION_ID, [ref('a.pdf')])).resolves.toEqual({ ok: true })
  })

  it('reports FAILURE on a non-2xx answer', async () => {
    stubFetch({ ok: false, status: 500 })

    const result = await purgeCollectionChunks(CONVERSATION_ID, [ref('a.pdf')])

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('500')
  })

  it('reports FAILURE when the backend is unreachable', async () => {
    stubFetch(new Error('ECONNREFUSED'))

    await expect(purgeCollectionChunks(CONVERSATION_ID, [ref('a.pdf')])).resolves.toMatchObject({ ok: false })
  })

  it('refuses a row that owns no chunks, so the purge cannot address another document', () => {
    expect(
      collectionFileRef({
        collectionName: CONVERSATION_ID,
        filename: 'a.pdf',
        authoredBy: 'agent',
        publishedVersionId: null,
      })
    ).toBeNull()
  })

  it('does not call the backend for an empty file list', async () => {
    const result = await purgeCollectionChunks(CONVERSATION_ID, [])
    expect(result).toEqual({ ok: true })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('purgeSessionDocuments', () => {
  it('erases chunks, objects and rows for a clean conversation', async () => {
    listSessionDocumentsForCleanup
      .mockResolvedValueOnce([sessionDoc(), sessionDoc({ id: 'doc-2', filename: 'plan.ifc' })])
      .mockResolvedValue([])

    const result = await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    expect(result).toMatchObject({ ok: true, purged: 2, retained: 0 })
    expect(deleteSessionDocumentsByIds).toHaveBeenCalledWith(['doc-1', 'doc-2'], ORG_ID, CONVERSATION_ID)
  })

  it('never sends a machine-authored filename to the chunk purge', async () => {
    listSessionDocumentsForCleanup.mockResolvedValue([
      sessionDoc(),
      sessionDoc({ id: 'doc-2', filename: 'brandschutz.pdf', authoredBy: 'agent' } as Partial<Document>),
    ])

    await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    const purge = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
    )
    expect(purge, 'the human row is still purged').toBeTruthy()
    expect(JSON.parse((purge?.[1] as RequestInit).body as string)).toEqual({
      file_ids: ['brandschutz.pdf'],
    })
  })

  it('KEEPS the row when SeaweedFS refuses the delete', async () => {
    listSessionDocumentsForCleanup.mockResolvedValue([sessionDoc()])
    send.mockRejectedValue(new Error('SeaweedFS 500'))

    const result = await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    expect(result.ok).toBe(false)
    expect(result.retained).toBe(1)
    expect(deleteSessionDocumentsByIds).toHaveBeenCalledWith([], ORG_ID, CONVERSATION_ID)
  })

  it('KEEPS the row when the chunk purge answers non-2xx', async () => {
    listSessionDocumentsForCleanup.mockResolvedValue([sessionDoc()])
    stubFetch({ ok: false, status: 502 })

    const result = await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    expect(result.ok).toBe(false)
    expect(result.retained).toBe(1)
    expect(deleteSessionDocumentsByIds).toHaveBeenCalledWith([], ORG_ID, CONVERSATION_ID)
    expect(send).toHaveBeenCalled()
  })

  it('keeps only the failed row and erases the rest of the page', async () => {
    const good = sessionDoc({ id: 'doc-good', storageKey: 'org/x/session/c/doc/good/a.pdf' })
    const bad = sessionDoc({ id: 'doc-bad', storageKey: 'org/x/session/c/doc/bad/b.pdf' })
    listSessionDocumentsForCleanup.mockResolvedValue([good, bad])
    send.mockImplementation((command: DeleteObjectCommand) =>
      command.input.Key?.includes('/bad/') ? Promise.reject(new Error('boom')) : Promise.resolve({}),
    )

    const result = await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    expect(result).toMatchObject({ ok: false, purged: 1, retained: 1 })
    expect(deleteSessionDocumentsByIds).toHaveBeenCalledWith(['doc-good'], ORG_ID, CONVERSATION_ID)
  })

  it('terminates when every row on the page is retained', async () => {
    listSessionDocumentsForCleanup.mockResolvedValue([sessionDoc()])
    send.mockRejectedValue(new Error('still down'))

    await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    expect(listSessionDocumentsForCleanup.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('purges the erased rows’ chunks once more after their rows are deleted', async () => {
    const order: string[] = []
    listSessionDocumentsForCleanup.mockResolvedValueOnce([sessionDoc()]).mockResolvedValue([])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') order.push(`purge:${init.body as string}`)
        return { ok: true, status: 200 }
      }),
    )
    deleteSessionDocumentsByIds.mockImplementation(async (ids: string[]) => {
      order.push(`rows:${ids.join(',')}`)
    })

    await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    const body = JSON.stringify({ file_ids: ['brandschutz.pdf'] })
    expect(order).toEqual([`purge:${body}`, 'rows:doc-1', `purge:${body}`])
  })

  it('makes no second purge for a retained row, and a failed second purge is only logged', async () => {
    const good = sessionDoc({ id: 'doc-good', filename: 'a.pdf', storageKey: 'org/x/session/c/doc/good/a.pdf' })
    const bad = sessionDoc({ id: 'doc-bad', filename: 'b.pdf', storageKey: 'org/x/session/c/doc/bad/b.pdf' })
    listSessionDocumentsForCleanup.mockResolvedValue([good, bad])
    send.mockImplementation((command: DeleteObjectCommand) =>
      command.input.Key?.includes('/bad/') ? Promise.reject(new Error('boom')) : Promise.resolve({}),
    )
    const bodies: string[] = []
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(init?.body as string)
        calls += 1
        return calls === 1 ? { ok: true, status: 200 } : { ok: false, status: 502 }
      }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await purgeSessionDocuments(CONVERSATION_ID, ORG_ID)

    expect(result).toMatchObject({ ok: false, purged: 1, retained: 1 })
    expect(bodies[1]).toBe(JSON.stringify({ file_ids: ['a.pdf'] }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('second chunk purge'), expect.stringContaining('502'))
    warn.mockRestore()
  })

  it('does nothing for a conversation with no attachments', async () => {
    listSessionDocumentsForCleanup.mockResolvedValue([])

    await expect(purgeSessionDocuments(CONVERSATION_ID, ORG_ID)).resolves.toMatchObject({
      ok: true,
      purged: 0,
    })
    expect(deleteSessionDocumentsByIds).not.toHaveBeenCalled()
  })
})

describe('deleteSessionCollection', () => {
  function stubFetchSequence(...statuses: number[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn()
    for (const status of statuses) {
      fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status })
    }
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('deletes an existing collection', async () => {
    const fetchMock = stubFetchSequence(200, 200)

    expect(await deleteSessionCollection(CONVERSATION_ID)).toEqual({ ok: true })
    const [probeUrl, probe] = fetchMock.mock.calls[0]
    const [deleteUrl, del] = fetchMock.mock.calls[1]
    expect(probeUrl).toBe(`http://backend:8000/v1/collections/${CONVERSATION_ID}`)
    expect(probe.method).toBe('GET')
    expect(deleteUrl).toBe(`http://backend:8000/v1/collections/${CONVERSATION_ID}`)
    expect(del.method).toBe('DELETE')
  })

  it('treats a missing collection as already erased, without deleting', async () => {
    const fetchMock = stubFetchSequence(404)

    expect(await deleteSessionCollection(CONVERSATION_ID)).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a deployment without a knowledge layer as having nothing to erase', async () => {
    stubFetchSequence(503)

    expect(await deleteSessionCollection(CONVERSATION_ID)).toEqual({ ok: true })
  })

  it('reports FAILURE when the delete is refused', async () => {
    stubFetchSequence(200, 500)

    const result = await deleteSessionCollection(CONVERSATION_ID)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('500')
  })

  it('reports FAILURE when the backend cannot be reached', async () => {
    stubFetch(new Error('ECONNREFUSED'))

    const result = await deleteSessionCollection(CONVERSATION_ID)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ECONNREFUSED')
  })
})
