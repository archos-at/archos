/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/backend-url', () => ({ getBackendUrl: () => 'http://backend:8000' }))

import { markCopyPoints } from './mark'

const fetchSpy = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchSpy.mockReset()
})

describe('markCopyPoints', () => {
  it('names the copy by its document id beside its stored name, so a same-named copy in another folder keeps its mark', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    vi.stubGlobal('fetch', fetchSpy.mockResolvedValue(new Response('{}', { status: 200 })))

    const marked = await markCopyPoints(
      { id: 'doc-normen', fileName: 'OIB-RL 2.pdf', collectionName: 'office_shelf_org-1', storedName: 'OIB-RL 2.pdf', folderId: 'folder-normen' },
      'edition-2023',
      { licenceClass: 'public_open', aiProcessingAttested: true, quoteMaxChars: 2000 },
    )

    expect(marked).toBe(true)
    expect(fetchSpy.mock.calls[0][0]).toBe('http://backend:8000/v1/collections/office_shelf_org-1/knowledge-mark')
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      file_name: 'OIB-RL 2.pdf',
      document_id: 'doc-normen',
      edition_id: 'edition-2023',
    })
  })
})
