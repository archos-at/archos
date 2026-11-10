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
const store = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/lib/cache', () => ({
  getCached: async (key: string, _ttl: number, loader: () => Promise<unknown>) =>
    store.has(key) ? store.get(key) : loader(),
  setCached: async (key: string, value: unknown) => void store.set(key, value),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { DOOR_QUOTE_FACTOR, doorTextOf, refuseLicensedFileForAgent } from './door-guard'

const session = { organizationId: 'org_a', userId: 'user_a' } as AuthorizedSession
const NORM = 'Tabelle 3 – Mindesthöhe 100 cm bis 12 m Absturzhöhe. '.repeat(40)
const read = async () => ({ text: NORM, truncated: false, contentType: 'text/markdown', filename: 'norm.md' })
const attested = { licenceClass: 'licensed', licensed: true, confirmed: true, aiProcessingAttested: true, quoteMaxChars: 100 }

beforeEach(() => {
  reader.agent = true
  licence.value = attested
  store.clear()
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
    licence.value = { ...attested, aiProcessingAttested: false }
    await expect(doorTextOf(session, 'doc4', read)).rejects.toMatchObject({ code: 'LICENSED_TEXT_WITHHELD' })
    licence.value = { ...attested, confirmed: false }
    await expect(doorTextOf(session, 'doc4', read)).rejects.toMatchObject({ code: 'LICENSED_TEXT_WITHHELD' })
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

describe('the person in the app', () => {
  it('reads the office’s licensed copy whole and gets its file: nothing here cuts their own pane', async () => {
    reader.agent = false
    for (let i = 0; i < 3; i++) expect((await doorTextOf(session, 'doc7', read)).text).toBe(NORM)
    await expect(refuseLicensedFileForAgent(session, 'doc7')).resolves.toBeUndefined()
  })
})
