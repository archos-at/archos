/**
 * @vitest-environment node
 *
 * The door's hold on an office's licensed copy (ADR-0159, design E19): an agent gets
 * no file or link of it, no text of an unattested one, and of an attested one at most
 * three quote caps per person and day; the person's own pane is never cut.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const reader = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/agent-api/acting-session', () => ({ actingReaderIsAgent: () => reader.agent }))
const licence = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('./text-guard', () => ({ licenceOfDocument: vi.fn(async () => licence.value) }))
const store = vi.hoisted(() => ({ counters: new Map<string, number>(), down: false }))
vi.mock('@/lib/cache', () => ({
  incrementCounter: async (key: string, by: number) => {
    if (store.down) return null
    const total = (store.counters.get(key) ?? 0) + by
    store.counters.set(key, total)
    return total
  },
}))
const access = vi.hoisted(() => ({ denied: false }))
vi.mock('@/lib/documents/access', () => ({
  getAccessibleDocument: vi.fn(async () => {
    if (access.denied) throw new NotFoundError()
    return {}
  }),
}))

import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { SearchResponse } from '@/lib/search/search-wire'
import type { SimilarPassagesResponse } from '@/lib/similar-passages/types'
import {
  DOOR_QUOTE_FACTOR,
  LICENSED_SNIPPET_NOTE,
  doorTextOf,
  refuseLicensedFileForAgent,
  searchForAgent,
  similarForAgent,
} from './door-guard'
import { licenceOfDocument } from './text-guard'

const session = { organizationId: 'org_a', userId: 'user_a' } as AuthorizedSession
const NORM = 'Tabelle 3 – Mindesthöhe 100 cm bis 12 m Absturzhöhe. '.repeat(40)
const read = async () => ({ text: NORM, truncated: false, contentType: 'text/markdown', filename: 'norm.md' })
const attested = { licenceClass: 'licensed', licensed: true, confirmed: true, aiProcessingAttested: true, quoteMaxChars: 100 }

beforeEach(() => {
  reader.agent = true
  licence.value = attested
  store.counters.clear()
  store.down = false
  access.denied = false
})

describe('an agent at the door', () => {
  it('reads an attested licensed copy only up to three quote caps, cumulatively, then is refused', async () => {
    const first = await doorTextOf(session, 'doc1', read)
    expect(first.text).toHaveLength(DOOR_QUOTE_FACTOR * 100)
    expect(first.truncated).toBe(true)
    await expect(doorTextOf(session, 'doc1', read)).rejects.toMatchObject({ status: 403, code: 'LICENSED_QUOTE_CAP_REACHED' })
  })

  it('adds reads of 120 characters up until the budget is spent', async () => {
    const small = async () => ({ text: NORM.slice(0, 120), truncated: false })
    const lengths = []
    for (let i = 0; i < 3; i++) lengths.push((await doorTextOf(session, 'doc2', small)).text.length)
    expect(lengths).toEqual([120, 120, 60])
    await expect(doorTextOf(session, 'doc2', small)).rejects.toMatchObject({ code: 'LICENSED_QUOTE_CAP_REACHED' })
  })

  it('counts each person apart', async () => {
    await doorTextOf(session, 'doc3', read)
    const other = await doorTextOf({ ...session, userId: 'user_b' }, 'doc3', read)
    expect(other.text).toHaveLength(300)
  })

  it('gets no text of a copy whose office has not attested AI processing, nor of an unconfirmed one', async () => {
    licence.value = { ...attested, aiProcessingAttested: false, held: true }
    await expect(doorTextOf(session, 'doc4', read)).rejects.toMatchObject({ code: 'BASE_COPY_HELD' })
    licence.value = { ...attested, confirmed: false, held: true }
    await expect(doorTextOf(session, 'doc4', read)).rejects.toMatchObject({ code: 'BASE_COPY_HELD' })
  })

  it('gets no text and no bytes of ANY held copy, whatever its licence class (one code)', async () => {
    licence.value = { licenceClass: 'public_open', licensed: false, confirmed: false, held: true, quoteMaxChars: 500 }
    await expect(doorTextOf(session, 'doc4b', read)).rejects.toMatchObject({ code: 'BASE_COPY_HELD' })
    await expect(refuseLicensedFileForAgent(session, 'doc4b')).rejects.toMatchObject({ code: 'BASE_COPY_HELD' })
    licence.value = { ...licence.value as object, confirmed: true, held: false }
    expect((await doorTextOf(session, 'doc4b', read)).text).toBe(NORM)
  })

  it('gets no file or link of a licensed copy', async () => {
    await expect(refuseLicensedFileForAgent(session, 'doc5')).rejects.toMatchObject({ code: 'LICENSED_COPY_NOT_SENT' })
  })

  it('reads every other document whole', async () => {
    licence.value = null
    expect((await doorTextOf(session, 'doc6', read)).text).toBe(NORM)
    await expect(refuseLicensedFileForAgent(session, 'doc6')).resolves.toBeUndefined()
    licence.value = { ...attested, licenceClass: 'public_open', licensed: false }
    expect((await doorTextOf(session, 'doc6', read)).text).toBe(NORM)
  })
})

describe('the budget', () => {
  it('is one per edition, so a second upload of the same copy does not reset it', async () => {
    licence.value = { ...attested, editionId: 'ed_1' }
    await doorTextOf(session, 'upload_a', read)
    await expect(doorTextOf(session, 'upload_b', read)).rejects.toMatchObject({ code: 'LICENSED_QUOTE_CAP_REACHED' })
  })

  it('is spent atomically: two reads in flight together get no more than the budget between them', async () => {
    const both = await Promise.all([doorTextOf(session, 'doc8', read), doorTextOf(session, 'doc8', read)].map((call) =>
      call.then((preview) => preview.text.length, () => 0)
    ))
    expect(both[0] + both[1]).toBe(DOOR_QUOTE_FACTOR * 100)
  })

  it('still cuts each call to the whole budget when the shared cache is down', async () => {
    store.down = true
    for (let i = 0; i < 2; i++) expect((await doorTextOf(session, 'doc9', read)).text).toHaveLength(DOOR_QUOTE_FACTOR * 100)
  })
})

describe('a document the person cannot open', () => {
  it('is not found, before any licence is read: a refusal would say the copy exists', async () => {
    access.denied = true
    vi.mocked(licenceOfDocument).mockClear()
    await expect(refuseLicensedFileForAgent(session, 'doc10')).rejects.toBeInstanceOf(NotFoundError)
    await expect(doorTextOf(session, 'doc10', read)).rejects.toBeInstanceOf(NotFoundError)
    expect(licenceOfDocument).not.toHaveBeenCalled()
  })
})

describe('search snippets', () => {
  const searched = (id: string): SearchResponse =>
    ({
      sections: {
        document: { hits: [{ kind: 'document', id, passage: { text: NORM.slice(0, 200), page: 4 } }], total: 1 },
      },
    }) as unknown as SearchResponse
  const similar = (documentId: string): SimilarPassagesResponse =>
    ({
      groups: [{ kind: 'office_shelf', project: null, documents: [{ documentId, passages: [{ page: 4, snippet: NORM.slice(0, 200), score: 0.9 }] }] }],
    }) as unknown as SimilarPassagesResponse

  it('of a licensed copy reach an agent as the note, its hit and page kept', async () => {
    const hit = (await searchForAgent(session, searched('doc11'))).sections.document?.hits[0]
    expect(hit?.passage).toEqual({ text: LICENSED_SNIPPET_NOTE, page: 4 })
    const passage = (await similarForAgent(session, similar('doc11'))).groups[0].documents[0].passages[0]
    expect(passage).toMatchObject({ snippet: LICENSED_SNIPPET_NOTE, page: 4 })
  })

  it('are withheld when the licence cannot be read (fail closed), on both search paths', async () => {
    vi.mocked(licenceOfDocument).mockRejectedValueOnce(new Error('db down'))
    expect((await searchForAgent(session, searched('doc12'))).sections.document?.hits[0].passage?.text).toBe(LICENSED_SNIPPET_NOTE)
    vi.mocked(licenceOfDocument).mockRejectedValueOnce(new Error('db down'))
    expect((await similarForAgent(session, similar('doc12'))).groups[0].documents[0].passages[0].snippet).toBe(LICENSED_SNIPPET_NOTE)
  })

  it('of a held copy of any class reach an agent as the note', async () => {
    licence.value = { licenceClass: 'public_open', licensed: false, confirmed: false, held: true, quoteMaxChars: 500 }
    expect((await searchForAgent(session, searched('doc12b'))).sections.document?.hits[0].passage?.text).toBe(LICENSED_SNIPPET_NOTE)
    expect((await similarForAgent(session, similar('doc12b'))).groups[0].documents[0].passages[0].snippet).toBe(LICENSED_SNIPPET_NOTE)
  })

  it('of any other document, and for the person, are as found', async () => {
    licence.value = null
    expect((await searchForAgent(session, searched('doc13'))).sections.document?.hits[0].passage?.text).toBe(NORM.slice(0, 200))
    licence.value = attested
    reader.agent = false
    expect((await similarForAgent(session, similar('doc13'))).groups[0].documents[0].passages[0].snippet).toBe(NORM.slice(0, 200))
  })
})

describe('the person in the app', () => {
  it('reads the office’s licensed copy whole and gets its file: nothing here cuts their own pane', async () => {
    reader.agent = false
    for (let i = 0; i < 3; i++) expect((await doorTextOf(session, 'doc7', read)).text).toBe(NORM)
    await expect(refuseLicensedFileForAgent(session, 'doc7')).resolves.toBeUndefined()
  })
})
