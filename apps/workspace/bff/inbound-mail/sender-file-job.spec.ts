/**
 * @vitest-environment node
 */
/**
 * The sender's own filing (`inbound_mail_sender_file`, ADR-0137's amendment):
 * a verified writer's mail is filed as that writer, re-checked as them, and
 * whatever it cannot file waits and is announced. Each case breaks one step of
 * a mail that would otherwise be filed. What the database refuses whatever this
 * job does is `scripts/rls-test-db.sh`'s 0194 section; the whole path against
 * Postgres is `review-first.e2e.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./repository', () => ({
  findMailForReceive: vi.fn(),
  findMailParts: vi.fn(),
  writeMailDecisions: vi.fn(async () => ({ decisions: [] })),
  MailChangedError: class MailChangedError extends Error {},
  PartNotWaitingError: class PartNotWaitingError extends Error {},
}))
vi.mock('./mail-views', () => ({ mailViews: vi.fn() }))
vi.mock('./sender-filing', () => ({ senderDecision: vi.fn(), withoutPart: vi.fn() }))
vi.mock('./decision', () => ({ mailIfMatch: vi.fn(() => 'if-1'), planMailDecision: vi.fn(), requireDecisionRights: vi.fn(async () => undefined) }))
vi.mock('./service', () => ({
  decisionContext: vi.fn(async () => ({ actor: { decidedBy: 'x', via: 'app', proposalId: null } })),
  FILING_CLAIM_MS: 300_000,
  filingJobId: (id: string) => `job-${id}`,
}))
vi.mock('./access', () => ({ requireMailReviewer: vi.fn(async () => ({ closed: false })) }))
vi.mock('./announce', () => ({ announceWaiting: vi.fn(async () => true) }))
vi.mock('./audit', () => ({ auditDecisions: vi.fn(async () => true) }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))
vi.mock('@/lib/auth/pinned-session', () => ({ resolvePinnedRequesterSessionStrict: vi.fn() }))
vi.mock('@/lib/authz/feature-flags', () => ({ isInboundMailEnabled: vi.fn(() => true) }))
vi.mock('@/lib/authz/folder-access', () => ({ requireFolderWrite: vi.fn(async () => undefined) }))
vi.mock('@/lib/filing/repository', () => ({ listProjectsFolders: vi.fn(async () => []) }))
vi.mock('@/lib/jobs-queue/repository', () => ({ findOpenJobId: vi.fn(async () => null) }))

import { captureServer } from '@/lib/analytics/posthog-server'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import { resolvePinnedRequesterSessionStrict } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import type { InboundMailSenderFilePayload } from '@/lib/jobs-queue/types'
import { FILE_PART_ID, filePart, heldMail, MAIL_ID, PERSON, PROJECT_ID, TEXT_PART_ID, textPart } from './__fixtures__/review'
import { requireMailReviewer } from './access'
import { announceWaiting } from './announce'
import { planMailDecision } from './decision'
import { mailViews } from './mail-views'
import { findMailForReceive, findMailParts, writeMailDecisions } from './repository'
import { senderDecision, withoutPart } from './sender-filing'
import { fileAsSender, runInboundMailSenderFile, SENDER_FILE_MAX_WAITS } from './sender-file-job'

const ORG = 'org_1'
const payload: InboundMailSenderFilePayload = { mailId: MAIL_ID, projectId: PROJECT_ID, waits: 0 }
const sender = { userId: PERSON, organizationId: ORG, email: 'anna@example.test', organizationMembershipId: 'om_1', role: 'member', permissions: [] } as unknown as AuthorizedSession
const decision = {
  mailId: MAIL_ID,
  ifMatch: 'if-1',
  parts: [{ partId: FILE_PART_ID, folderId: null, newFolderPath: 'Statik', name: 'S.pdf' }],
  message: { partId: TEXT_PART_ID, text: 'full' as const, thread: { action: 'append' as const, mailThreadId: 'thread-1' } },
}
const plan = (files: string[]) => ({
  mailId: MAIL_ID,
  ifMatch: 'if-1',
  files: files.map((partId) => ({ id: `decision-${partId}`, partId })),
  writeFolders: [],
  freshNames: [],
})

let info: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findMailForReceive).mockResolvedValue(heldMail({ senderClass: 'verified_writer', senderUserId: PERSON }))
  vi.mocked(findMailParts).mockResolvedValue([textPart(), filePart()])
  vi.mocked(resolvePinnedRequesterSessionStrict).mockResolvedValue(sender)
  vi.mocked(requireMailReviewer).mockResolvedValue({ closed: false })
  vi.mocked(findOpenJobId).mockResolvedValue(null)
  vi.mocked(mailViews).mockResolvedValue([{ id: MAIL_ID } as never])
  vi.mocked(senderDecision).mockReturnValue(decision as never)
  vi.mocked(planMailDecision).mockReturnValue(plan([FILE_PART_ID, TEXT_PART_ID]) as never)
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('the sender’s own filing', () => {
  it('files a verified writer’s mail as them: via sender, the others left waiting, the filing job in the same transaction', async () => {
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'filed', parts: 2, left: 0 })

    expect(resolvePinnedRequesterSessionStrict).toHaveBeenCalledWith({ userId: PERSON, email: null, organizationId: ORG })
    const [writes, actor, , , job] = vi.mocked(writeMailDecisions).mock.calls[0]!
    expect(writes).toEqual([expect.objectContaining({ mailId: MAIL_ID, keepOthers: true })])
    expect(actor).toEqual({ decidedBy: PERSON, via: 'sender', proposalId: null })
    expect(job).toMatchObject({
      jobId: `job-decision-${FILE_PART_ID}`,
      payload: { projectId: PROJECT_ID, mailIds: [MAIL_ID], decisionIds: [`decision-${FILE_PART_ID}`, `decision-${TEXT_PART_ID}`], requester: expect.objectContaining({ userId: PERSON }) },
    })
    expect(announceWaiting).not.toHaveBeenCalled()
  })

  it('files nothing while direct filing is switched off, and says the mail waits', async () => {
    vi.stubEnv('INBOUND_MAIL_DIRECT_FILING', 'false')
    try {
      expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'direct_filing_off' })
    } finally {
      vi.unstubAllEnvs()
    }
    expect(writeMailDecisions).not.toHaveBeenCalled()
    expect(announceWaiting).toHaveBeenCalledOnce()
  })

  it('files only a verified writer’s mail, and nothing a person decided first', async () => {
    vi.mocked(findMailForReceive).mockResolvedValueOnce(heldMail({ senderClass: 'unverified_writer', senderTrust: 'member_unverified', senderReason: 'dkim_fail' }))
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'not_verified_writer' })
    vi.mocked(findMailForReceive).mockResolvedValueOnce(heldMail({ senderClass: 'verified_writer', status: 'settled' }))
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'not_waiting' })
    vi.mocked(findMailForReceive).mockResolvedValueOnce(heldMail({ senderClass: 'verified_writer', organizationId: 'org_2' }))
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'not_waiting' })
    expect(writeMailDecisions).not.toHaveBeenCalled()
  })

  it('waits for the agent’s suggestion, a bounded number of times, then files without it', async () => {
    vi.mocked(findOpenJobId).mockResolvedValue('suggest-job')
    const later = await runInboundMailSenderFile(ORG, payload, { last: false })
    expect(later).toMatchObject({ done: false, payload: { waits: 1 } })
    expect(writeMailDecisions).not.toHaveBeenCalled()

    expect(await runInboundMailSenderFile(ORG, { ...payload, waits: SENDER_FILE_MAX_WAITS }, { last: false })).toMatchObject({ done: true })
    expect(writeMailDecisions).toHaveBeenCalledOnce()
  })

  it('files nothing for a sender who left or may no longer write, and says the mail waits', async () => {
    vi.mocked(resolvePinnedRequesterSessionStrict).mockResolvedValueOnce(null)
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'sender_left' })
    vi.mocked(requireMailReviewer).mockRejectedValueOnce(new NotFoundError())
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'no_access' })
    vi.mocked(requireMailReviewer).mockResolvedValueOnce({ closed: true })
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'no_access' })
    expect(writeMailDecisions).not.toHaveBeenCalled()
    expect(announceWaiting).toHaveBeenCalledTimes(3)
  })

  it('leaves a part the review refuses waiting, files the rest, and announces what waits', async () => {
    vi.mocked(planMailDecision)
      .mockImplementationOnce(() => {
        throw new ConflictError('taken', { reason: 'name_taken', partId: FILE_PART_ID })
      })
      .mockReturnValueOnce(plan([TEXT_PART_ID]) as never)
    vi.mocked(withoutPart).mockReturnValueOnce({ ...decision, parts: [] } as never)

    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'filed', parts: 1, left: 1 })
    expect(withoutPart).toHaveBeenCalledWith(decision, FILE_PART_ID)
    expect(announceWaiting).toHaveBeenCalledWith(expect.objectContaining({ mailId: MAIL_ID }))
  })

  it('leaves the whole mail waiting when nothing of it can go without the sender', async () => {
    vi.mocked(senderDecision).mockReturnValueOnce(null)
    expect(await fileAsSender(ORG, payload)).toEqual({ kind: 'waits', reason: 'nothing_to_file' })
    expect(announceWaiting).toHaveBeenCalledOnce()
  })

  it('announces the mail on the last attempt of a run that fails, so it is never left untold', async () => {
    vi.mocked(mailViews).mockRejectedValue(new Error('db down'))
    await expect(runInboundMailSenderFile(ORG, payload, { last: false })).rejects.toThrow('db down')
    expect(announceWaiting).not.toHaveBeenCalled()
    await expect(runInboundMailSenderFile(ORG, payload, { last: true })).rejects.toThrow('db down')
    expect(announceWaiting).toHaveBeenCalledOnce()
  })

  it('reports every run that ends as one personless event and an info line: filed, waits with its reason, or failed', async () => {
    const events = () => vi.mocked(captureServer).mock.calls.map(([call]) => call).filter((call) => call.event === 'inbound_mail_sender_filed')

    await runInboundMailSenderFile(ORG, payload, { last: false })
    expect(events()).toEqual([
      { event: 'inbound_mail_sender_filed', distinctId: null, organizationId: ORG, properties: { outcome: 'filed', files: 2, left: 0, waits_for_suggestion: 0 } },
    ])
    expect(info).toHaveBeenCalledWith(`[inbound-mail] sender filing of mail ${MAIL_ID}: filed`)

    vi.mocked(captureServer).mockClear()
    vi.mocked(senderDecision).mockReturnValueOnce(null)
    await runInboundMailSenderFile(ORG, payload, { last: false })
    expect(events()).toEqual([expect.objectContaining({ properties: { outcome: 'waits', reason: 'nothing_to_file', waits_for_suggestion: 0 } })])

    vi.mocked(captureServer).mockClear()
    vi.mocked(findOpenJobId).mockResolvedValueOnce('suggest-job')
    await runInboundMailSenderFile(ORG, payload, { last: false })
    expect(events()).toEqual([])

    vi.mocked(mailViews).mockRejectedValueOnce(new Error('db down'))
    await expect(runInboundMailSenderFile(ORG, payload, { last: true })).rejects.toThrow('db down')
    expect(events()).toEqual([expect.objectContaining({ properties: { outcome: 'failed', last_attempt: true } })])
    // Codes and counts only: nothing a sender wrote.
    expect(JSON.stringify(vi.mocked(captureServer).mock.calls)).not.toMatch(/anna|example\.test|db down/)
  })
})
