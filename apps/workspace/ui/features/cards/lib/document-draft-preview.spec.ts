import { describe, expect, it, vi } from 'vitest'
import {
  DocumentDraftPreviewError,
  fetchConversationDraft,
} from './document-draft-preview'

const DRAFT = {
  path: '/entwuerfe/aktenvermerk.md',
  content: '# Aktenvermerk\n\nText.',
  version: 3,
  bytes: 24,
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

function refused(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as Response
}

describe('fetchConversationDraft', () => {
  it('reads one draft through the BFF preview door, encoded', async () => {
    const run = vi.fn(async (_url: string, _init?: RequestInit) => ok(DRAFT))

    const draft = await fetchConversationDraft('s_conv 1', '/entwuerfe/a b.md', run)

    expect(draft).toEqual(DRAFT)
    const [url, init] = run.mock.calls[0]
    expect(url).toBe('/api/conversations/s_conv%201/draft?path=%2Fentwuerfe%2Fa%20b.md')
    expect(init).toMatchObject({ method: 'GET' })
  })

  it('carries the refusal as a typed error, not a thrown Response', async () => {
    const run = vi.fn(async () => refused(404, { error: 'Not found', code: 'NOT_FOUND' }))

    const failure = await fetchConversationDraft('conv-1', '/entwuerfe/a.md', run).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(DocumentDraftPreviewError)
    expect(failure as DocumentDraftPreviewError).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('refuses a body that is not a draft rather than rendering it', async () => {
    const run = vi.fn(async () => ok({ path: '/entwuerfe/a.md' }))

    await expect(fetchConversationDraft('conv-1', '/entwuerfe/a.md', run)).rejects.toThrow()
  })
})
