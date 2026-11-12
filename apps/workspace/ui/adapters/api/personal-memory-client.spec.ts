/**
 * @vitest-environment node
 *
 * The requests „Mein Gedächtnis“ makes on the person's own notes
 * (`/api/user/memory`, ADR-0180), and the status each failure carries: the
 * panel tells a 409 on an edit (another note already says it) from any other
 * failure, so the status must be what the caller gets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from './api-error'
import {
  clearPersonalMemory,
  addPersonalMemoryNote,
  listPersonalMemory,
  removePersonalMemoryNote,
  updatePersonalMemoryNote,
} from './personal-memory-client'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const NOTE = {
  id: 'n-1',
  kind: 'preference',
  content: 'Antworten bitte knapp.',
  provenanceType: 'user',
  pinned: false,
  sourceConversationId: null,
  createdAt: '2026-11-10T08:00:00Z',
  updatedAt: '2026-11-10T08:00:00Z',
}

describe('listPersonalMemory', () => {
  it('reads the first page without a query when nothing is asked', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [NOTE], nextCursor: null }))

    const page = await listPersonalMemory()

    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory')
    expect(page.items).toEqual([NOTE])
  })

  it('carries the limit and the cursor of the next page', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))

    await listPersonalMemory({ limit: 200, cursor: 'c 2' })

    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory?limit=200&cursor=c+2')
  })

  it('throws the typed error with the status when the read fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))

    await expect(listPersonalMemory()).rejects.toMatchObject({ status: 500 })
  })
})

describe('addPersonalMemoryNote', () => {
  it('posts the kind and the text, and answers the note', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ item: NOTE, created: true }, { status: 201 }))

    const { item, created } = await addPersonalMemoryNote({ kind: 'preference', content: 'Antworten bitte knapp.' })

    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ kind: 'preference', content: 'Antworten bitte knapp.' }),
    })
    expect(item).toEqual(NOTE)
    expect(created).toBe(true)
  })

  it('says when the note was already held', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ item: NOTE, created: false }, { status: 200 }))

    expect(await addPersonalMemoryNote({ kind: 'preference', content: 'antworten bitte knapp' })).toEqual({
      item: NOTE,
      created: false,
    })
  })

  it('throws the typed error with the status when the write is refused', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }))

    await expect(addPersonalMemoryNote({ kind: 'profile', content: '' })).rejects.toBeInstanceOf(ApiRequestError)
  })
})

describe('updatePersonalMemoryNote', () => {
  it('patches one note by its id', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ item: { ...NOTE, pinned: true } }))

    const { item } = await updatePersonalMemoryNote('n/1', { pinned: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory/n%2F1', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ pinned: true }),
    })
    expect(item.pinned).toBe(true)
  })

  it('carries 409 when another note already says the new text', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Another personal note already says this' }, { status: 409 }))

    await expect(updatePersonalMemoryNote('n-1', { content: 'Doppelt.' })).rejects.toMatchObject({ status: 409 })
  })
})

describe('removePersonalMemoryNote', () => {
  it('deletes one note and answers nothing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(removePersonalMemoryNote('n-1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory/n-1', { method: 'DELETE' })
  })

  it('carries 404 for a note that is not the caller’s', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }))

    await expect(removePersonalMemoryNote('n-9')).rejects.toMatchObject({ status: 404 })
  })
})

describe('clearPersonalMemory', () => {
  it('deletes the whole collection and answers how many notes went', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ removed: 4 }))

    await expect(clearPersonalMemory()).resolves.toEqual({ removed: 4 })
    expect(fetchMock).toHaveBeenCalledWith('/api/user/memory', { method: 'DELETE' })
  })

  it('throws the typed error with the status when the server refuses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 403 }))

    await expect(clearPersonalMemory()).rejects.toMatchObject({ status: 403 })
  })
})
