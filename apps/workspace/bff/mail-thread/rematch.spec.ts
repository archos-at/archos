/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({
  findWaitingMailsNearThread: vi.fn(async () => []),
  recordThreadMatch: vi.fn(async () => true),
}))
vi.mock('@/lib/inbound-mail/repository', () => ({
  findThreadCandidates: vi.fn(async () => []),
  findPartSummaries: vi.fn(async () => [{ kind: 'message', riskFlags: [], contentFindings: [] }]),
}))
vi.mock('@/lib/inbound-mail/follow-candidate', () => ({ queueFollowIfEligible: vi.fn(async () => true) }))

import { heldMail, PROJECT_ID } from '@/lib/inbound-mail/__fixtures__/review'
import { queueFollowIfEligible } from '@/lib/inbound-mail/follow-candidate'
import { findThreadCandidates } from '@/lib/inbound-mail/repository'
import type { ThreadCandidate } from './mail-threading'
import { rematchAfterWrite, rematchWaitingMails } from './rematch'
import { findWaitingMailsNearThread, recordThreadMatch } from './repository'

const FILED = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c60'
const thread = { id: FILED, baseSubject: 'statik einreichung', threadIndexGuid: null }

const filedThread = (overrides: Partial<ThreadCandidate> = {}): ThreadCandidate => ({
  threadId: FILED,
  baseSubject: 'statik einreichung',
  threadIndexGuid: null,
  receivedIds: ['<first@example.test>'],
  referencedIds: [],
  participants: [],
  lastEntryAt: new Date('2026-10-21T08:00:00Z'),
  ...overrides,
})

const reply = heldMail({ senderClass: 'external', senderTrust: 'external_verified', threadMatch: [] })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INBOUND_MAIL_DOMAIN', 'example.org')
  vi.mocked(findWaitingMailsNearThread).mockResolvedValue([reply])
  vi.mocked(findThreadCandidates).mockResolvedValue([filedThread()])
})

describe('a reply that waited before its first mail was filed', () => {
  it('matches the Verlauf that mail started, by reference, and its follow is asked', async () => {
    expect(await rematchWaitingMails(PROJECT_ID, thread)).toBe(1)

    expect(findThreadCandidates).toHaveBeenCalledWith(PROJECT_ID, {
      messageIds: ['<reply-2@statik-weber.at>', '<first@example.test>', '<first@example.test>'],
      threadIndexGuid: null,
      baseSubject: 'statik einreichung',
      participants: [],
    })
    const matches = [{ threadId: FILED, strength: 'reference', headers: ['in-reply-to', 'references'] }]
    expect(recordThreadMatch).toHaveBeenCalledWith(reply.id, matches)
    expect(queueFollowIfEligible).toHaveBeenCalledWith(
      { ...reply, threadMatch: matches },
      [{ kind: 'message', riskFlags: [], contentFindings: [] }],
      'example.org',
      null
    )
  })

  it('changes nothing for a mail whose match is what it was', async () => {
    vi.mocked(findWaitingMailsNearThread).mockResolvedValue([
      { ...reply, threadMatch: [{ threadId: FILED, strength: 'reference', headers: ['in-reply-to', 'references'] }] },
    ])
    expect(await rematchWaitingMails(PROJECT_ID, thread)).toBe(0)
    expect(recordThreadMatch).not.toHaveBeenCalled()
    expect(queueFollowIfEligible).not.toHaveBeenCalled()
  })

  it('records a match by subject alone, and asks no follow for it', async () => {
    vi.mocked(findThreadCandidates).mockResolvedValue([filedThread({ receivedIds: [], participants: ['p.weber@statik-weber.at'] })])
    vi.mocked(findWaitingMailsNearThread).mockResolvedValue([
      { ...reply, participants: [{ role: 'from', name: null, address: 'p.weber@statik-weber.at' }] },
    ])
    expect(await rematchWaitingMails(PROJECT_ID, thread)).toBe(1)
    expect(recordThreadMatch).toHaveBeenCalledWith(reply.id, [{ threadId: FILED, strength: 'subject', headers: ['subject'] }])
    expect(queueFollowIfEligible).not.toHaveBeenCalled()
  })

  it('asks no follow for a writer’s own mail, which its sender filing files', async () => {
    vi.mocked(findWaitingMailsNearThread).mockResolvedValue([{ ...reply, senderClass: 'verified_writer' }])
    await rematchWaitingMails(PROJECT_ID, thread)
    expect(recordThreadMatch).toHaveBeenCalledOnce()
    expect(queueFollowIfEligible).not.toHaveBeenCalled()
  })

  it('asks no follow for a mail that was decided in between', async () => {
    vi.mocked(recordThreadMatch).mockResolvedValueOnce(false)
    expect(await rematchWaitingMails(PROJECT_ID, thread)).toBe(0)
    expect(queueFollowIfEligible).not.toHaveBeenCalled()
  })
})

describe('after a write', () => {
  it('keeps the filing: a re-match that fails leaves the mails their match, and the next thread is still tried', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(findWaitingMailsNearThread).mockRejectedValueOnce(new Error('connection reset')).mockResolvedValueOnce([reply])
    await expect(rematchAfterWrite(PROJECT_ID, [thread, { ...thread, id: 'other' }])).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(FILED), expect.any(Error))
    expect(recordThreadMatch).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
