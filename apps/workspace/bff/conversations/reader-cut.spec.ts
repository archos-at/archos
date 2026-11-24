/**
 * @vitest-environment node
 *
 * Joining later (ADR-0194, what it makes possible 2): a reader who may not
 * open every source of a chat sees it up to the first answer resting on one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AnswerTrail } from './answer-trail'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ answers: [] as string[], trails: [] as unknown[], locked: true }))
vi.mock('./repository', () => ({ listAnswerIdsInOrder: vi.fn(async () => state.answers) }))
vi.mock('./answer-trail', () => ({
  trailsAsSeenBy: vi.fn(async () => state.trails),
  restsOnWithheld: (trail: AnswerTrail) => trail.places.some((place) => 'withheld' in place),
}))
vi.mock('@/lib/sharing/access', () => ({
  requireResourceAccess: vi.fn(async () => ({ contentLocked: state.locked })),
}))

import { requireResourceAccess } from '@/lib/sharing/access'
import { readableAnswerTrails, readerCut } from './reader-cut'

const session = { organizationId: 'org_1', userId: 'user_ina' } as AuthorizedSession
const trail = (messageId: string, places: AnswerTrail['places'] = []): AnswerTrail => ({
  messageId,
  places,
  personalMemory: false,
  personalShelf: false,
  solo: false,
})
const open = trail('a1', [{ kind: 'folder', id: 'f_open', name: 'Pläne' }])
const restricted = trail('a2', [{ kind: 'folder', withheld: true }])
const ownless = trail('a3')

beforeEach(() => {
  vi.clearAllMocks()
  state.locked = true
  state.answers = ['a1', 'a2', 'a3']
  state.trails = [ownless, restricted, open]
})

describe('readerCut', () => {
  it('cuts at the first answer resting on a withheld source, so a later answer without one is withheld too', async () => {
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'until', answerId: 'a2', readable: [open] })
  })

  it('keeps the whole chat locked when an answer before the cut has no record', async () => {
    state.trails = [restricted, ownless]
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })

  it('keeps the whole chat locked when no answer names what the reader may not open', async () => {
    state.trails = [open, trail('a2'), ownless]
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })

  it('keeps the whole chat locked past the answers it reads', async () => {
    state.answers = Array.from({ length: 501 }, (_, i) => `a${i}`)
    expect(await readerCut(session, 's_c')).toEqual({ kind: 'none' })
  })
})

describe('readableAnswerTrails', () => {
  it('gives a reader who may read the chat every trail', async () => {
    state.locked = false
    expect(await readableAnswerTrails(session, 's_c')).toEqual({ answers: state.trails, nextCursor: null })
    expect(requireResourceAccess).toHaveBeenCalledWith(session, 'conversation', 's_c', 'viewer', { allowLocked: true })
  })

  it('gives a reader who joined later only the trails before the cut', async () => {
    expect(await readableAnswerTrails(session, 's_c')).toEqual({ answers: [open], nextCursor: null })
  })

  it('pages the newest answers first, oldest first within the page, earlier ones through the cursor', async () => {
    state.locked = false
    state.trails = [open, restricted, ownless]
    expect(await readableAnswerTrails(session, 's_c', { limit: 2 })).toEqual({ answers: [restricted, ownless], nextCursor: 'a2' })
    expect(await readableAnswerTrails(session, 's_c', { limit: 2, cursor: 'a2' })).toEqual({ answers: [open], nextCursor: null })
  })

  it('refuses a reader the whole chat stays locked for', async () => {
    state.trails = []
    await expect(readableAnswerTrails(session, 's_c')).rejects.toMatchObject({ status: 403 })
  })
})
