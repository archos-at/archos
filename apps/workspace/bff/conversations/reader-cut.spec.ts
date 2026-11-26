/**
 * @vitest-environment node
 *
 * Joining later (ADR-0194, what it makes possible 2): a reader who may not
 * open every source of a chat sees it up to the turn of the first answer
 * resting on one, and only when the records account for every source they
 * may not open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({
  order: [] as { id: string; role: string }[],
  reads: [] as { messageId: string; readFolders: string[]; readProjects: string[] }[],
  closed: { folders: new Set<string>(), projects: new Set<string>() },
  locked: true,
}))
vi.mock('./repository', () => ({ listMessageRolesInOrder: vi.fn(async () => state.order) }))
vi.mock('./restricted-use', () => ({ unreadableSourcesOf: vi.fn(async () => state.closed) }))
vi.mock('./answer-trail', () => ({
  answerReadsOf: vi.fn(async () => state.reads),
  trailsAsSeenBy: vi.fn(async () =>
    state.reads.map((read) => ({ messageId: read.messageId, places: [], personalMemory: false, personalShelf: false, solo: false })),
  ),
}))
vi.mock('@/lib/sharing/access', () => ({
  requireResourceAccess: vi.fn(async () => ({ contentLocked: state.locked })),
}))

import { readableAnswerTrails, readerCut } from './reader-cut'

const session = { organizationId: 'org_1', userId: 'user_ina' } as AuthorizedSession
const read = (messageId: string, readFolders: string[] = [], readProjects: string[] = []) => ({ messageId, readFolders, readProjects })
const chat = ['q1', 'a1', 'q2', 'a2', 'q3', 'a3', 'q4'].map((id) => ({ id, role: id.startsWith('a') ? 'assistant' : 'user' }))

beforeEach(() => {
  vi.clearAllMocks()
  state.locked = true
  state.order = chat
  state.reads = [read('a1', ['f_open']), read('a2', ['f_closed']), read('a3')]
  state.closed = { folders: new Set(['f_closed']), projects: new Set() }
})

describe('readerCut', () => {
  it('cuts before the question of the first answer resting on a closed source, so a later answer without one is withheld too', async () => {
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'until', messageId: 'q2', readableAnswers: new Set(['a1']) })
  })

  it('cuts on another project the reader may not open, as on a folder', async () => {
    state.reads = [read('a1'), read('a2', [], ['p_closed']), read('a3')]
    state.closed = { folders: new Set(), projects: new Set(['p_closed']) }
    expect(await readerCut(session, 's_c')).toMatchObject({ kind: 'until', messageId: 'q2' })
  })

  it('keeps the whole chat locked when a closed source of the ledger is named by no record from the cut on', async () => {
    state.closed = { folders: new Set(['f_closed', 'f_purged']), projects: new Set() }
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })

  it('keeps the whole chat locked when an answer before the cut has no record', async () => {
    state.reads = [read('a2', ['f_closed']), read('a3')]
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })

  it('keeps the whole chat locked when the first answer already rests on a closed source', async () => {
    state.reads = [read('a1', ['f_closed']), read('a2'), read('a3')]
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })

  it('keeps the whole chat locked when no record names what the reader may not open', async () => {
    state.reads = [read('a1'), read('a2'), read('a3')]
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })

  it('keeps the whole chat locked past the messages it reads', async () => {
    state.order = Array.from({ length: 5001 }, (_, i) => ({ id: `m${i}`, role: 'user' }))
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })
})

describe('readableAnswerTrails', () => {
  it('gives a reader who may read the chat every trail', async () => {
    state.locked = false
    const page = await readableAnswerTrails(session, 's_c')
    expect(page.answers.map((trail) => trail.messageId)).toEqual(['a1', 'a2', 'a3'])
  })

  it('gives a reader who joined later only the trails before the cut', async () => {
    const page = await readableAnswerTrails(session, 's_c')
    expect(page.answers.map((trail) => trail.messageId)).toEqual(['a1'])
  })

  it('pages the newest answers first, oldest first within the page, earlier ones through the cursor', async () => {
    state.locked = false
    expect((await readableAnswerTrails(session, 's_c', { limit: 2 })).nextCursor).toBe('a2')
    const earlier = await readableAnswerTrails(session, 's_c', { limit: 2, cursor: 'a2' })
    expect(earlier).toMatchObject({ answers: [{ messageId: 'a1' }], nextCursor: null })
  })

  it('refuses a reader the whole chat stays locked for', async () => {
    state.reads = []
    await expect(readableAnswerTrails(session, 's_c')).rejects.toMatchObject({ status: 403 })
  })
})
