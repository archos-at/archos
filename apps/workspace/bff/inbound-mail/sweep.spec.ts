/**
 * @vitest-environment node
 *
 * The sweeps' order and their isolation (`./sweep.ts`). What each sweep does
 * to the rows is proven against Postgres (`sweep.integration.spec.ts`); this
 * spec holds what no row shows: sweep 11 runs before the two that wait for the
 * audit trail, sweep 12 before the one that deletes the follows it ends, one
 * failing sweep costs no other its turn, the caps' thresholds, and sweep 7
 * queueing a verified writer's filing again once a scan turns clean (S2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const repository = vi.hoisted(() => {
  const empty = () => vi.fn(async () => [])
  return {
    findStaleReceptions: empty(),
    findReceivedWithoutJob: empty(),
    findLapsedClaims: empty(),
    findStalledMoves: empty(),
    findUnauditedDecisions: empty(),
    findExpiredMails: empty(),
    findExpiringMails: empty(),
    findEndedPartBytes: empty(),
    findMailsToSettle: empty(),
    findFailedScans: empty(),
    recordPartRescan: vi.fn(async () => true),
    recordRawRescan: vi.fn(async () => true),
    findUnreadTexts: empty(),
    leaseReread: vi.fn(async (mail: { readerFaultAt: Date }, leasedAt: Date) => ({ ...mail, readerFaultAt: leasedAt })),
    findReleasedErasures: empty(),
    findKeptMails: empty(),
    deleteKeptMails: empty(),
    findEndingFollows: empty(),
    findExpiringFollows: empty(),
    findOrphanedThreads: empty(),
    findAddressCapStates: empty(),
  }
})
vi.mock('./sweep-repository', () => repository)
vi.mock('@/lib/db/tenant-context', () => ({
  withPlatformAccess: async <T>(_reason: string, fn: () => T) => fn(),
  withTenant: async <T>(_scope: unknown, fn: () => T) => fn(),
}))
vi.mock('./announce', () => ({}))
vi.mock('./audit', () => ({ auditDecisions: vi.fn() }))
vi.mock('./filing-repository', () => ({ projectIsHeld: vi.fn() }))
vi.mock('./malware-scan', () => ({ scanForStorage: vi.fn() }))
vi.mock('./repository', () => ({ queueReceiveJob: vi.fn() }))
vi.mock('./receive-reread', () => ({ rereadHeldText: vi.fn() }))
vi.mock('./receive-sender', () => ({ queueSenderFiling: vi.fn(async () => undefined) }))
vi.mock('./staging', () => ({ eraseStagedObjects: vi.fn(), readStagedObject: vi.fn() }))
vi.mock('./receive', () => ({
  INBOUND_MAIL_ADDRESS_STAGED_BYTES: 1024 * 1024 * 1024,
  INBOUND_MAIL_ORGANIZATION_STAGED_BYTES: 5 * 1024 * 1024 * 1024,
}))
vi.mock('@/lib/mail-thread/originals', () => ({ finishOriginalMove: vi.fn() }))
vi.mock('@/lib/mail-thread/write-repository', () => ({ findEntryOfMail: vi.fn(), forgetMovedRaw: vi.fn() }))
vi.mock('@/lib/mail-thread/follows', () => ({ endFollowBySystem: vi.fn() }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn(), SYSTEM_ACTORS: { inboundMail: 'system:inbound_mail' } }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))

import { scanForStorage } from './malware-scan'
import { rereadHeldText } from './receive-reread'
import { queueSenderFiling } from './receive-sender'
import { capNoticeFor, REREAD_BATCH, REREAD_BUDGET_MS, SWEEP_ORDER, sweepFailedScans, sweepInboundMail, sweepUnreadTexts } from './sweep'

const GIB = 1024 * 1024 * 1024

afterEach(() => {
  vi.clearAllMocks()
})

describe('the order the sweeps run in', () => {
  const at = (name: (typeof SWEEP_ORDER)[number]) => SWEEP_ORDER.indexOf(name)

  it('sends what is owed to the audit trail before the two sweeps that wait for it (RT-S8)', () => {
    expect(at('audits')).toBeLessThan(at('keptMails'))
    expect(at('audits')).toBeLessThan(at('threads'))
  })

  it('ends the follows (audited) before the sweep that deletes them with their thread', () => {
    expect(at('follows')).toBeLessThan(at('threads'))
  })

  it('runs every sweep of DECISION §5, the caps and the re-reads, once', () => {
    expect(new Set(SWEEP_ORDER).size).toBe(15)
  })
})

describe('one sweep failing', () => {
  it('costs no other its turn, and is counted, not thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repository.findExpiredMails.mockRejectedValueOnce(new Error('database gone'))

    const result = await sweepInboundMail(new Date())

    expect(result.expired).toEqual({ checked: 0, errors: 1, failed: 1 })
    expect(Object.keys(result)).toEqual([...SWEEP_ORDER])
    // The sweeps after it still ran.
    expect(repository.findKeptMails).toHaveBeenCalledTimes(1)
    expect(repository.findAddressCapStates).toHaveBeenCalledTimes(1)
    expect(result.keptMails).toEqual({ checked: 0, errors: 0, deleted: 0 })
  })
})

describe('the caps (D18)', () => {
  const state = (addressBytes: number, organizationBytes = addressBytes, revoked = false) => ({ addressBytes, organizationBytes, revoked })

  it('is nearly full at 80% of the address’s or the organization’s cap, and full at 100%', () => {
    expect(capNoticeFor(state(0.79 * GIB))).toBeNull()
    expect(capNoticeFor(state(0.8 * GIB))).toBe('nearly_full')
    expect(capNoticeFor(state(GIB))).toBe('full')
    expect(capNoticeFor(state(0, 4 * GIB))).toBe('nearly_full')
    expect(capNoticeFor(state(0, 5 * GIB))).toBe('full')
  })

  it('says nothing of a revoked address: its successor is a new row', () => {
    expect(capNoticeFor(state(GIB, GIB, true))).toBeNull()
  })
})

describe('sweep 7 and a verified writer’s mail (S2 of the 2026-11 ship review)', () => {
  const failed = (senderClass: string | null, kind: 'part' | 'raw' = 'raw') => ({
    id: kind === 'raw' ? 'm1' : 'p1',
    kind,
    mailId: 'm1',
    organizationId: 'org_1',
    projectId: 'proj_1',
    senderClass,
    stagingBucket: 'b',
    storageKey: 'k',
  })
  const scanned = (status: 'clean' | 'failed' | 'infected') =>
    vi.mocked(scanForStorage).mockResolvedValue({ status, engine: null, signature: null, scannedAt: new Date() })

  it('queues the sender’s filing again, by name, when a raw message or a part of a verified writer’s mail scans clean', async () => {
    scanned('clean')
    repository.findFailedScans.mockResolvedValueOnce([failed('verified_writer'), failed('verified_writer', 'part')] as never)

    const result = await sweepFailedScans(new Date())

    expect(queueSenderFiling).toHaveBeenCalledWith({ id: 'm1', organizationId: 'org_1', projectId: 'proj_1' })
    expect(result.senderFilingQueued).toBe(2)
  })

  it('queues nothing for another class, for a scan that failed again, or for a rescan another run recorded', async () => {
    scanned('clean')
    repository.findFailedScans.mockResolvedValueOnce([failed('office_member'), failed('external', 'part')] as never)
    await sweepFailedScans(new Date())
    scanned('failed')
    repository.findFailedScans.mockResolvedValueOnce([failed('verified_writer')] as never)
    await sweepFailedScans(new Date())
    scanned('clean')
    repository.recordRawRescan.mockResolvedValueOnce(false)
    repository.findFailedScans.mockResolvedValueOnce([failed('verified_writer')] as never)
    await sweepFailedScans(new Date())

    expect(queueSenderFiling).not.toHaveBeenCalled()
  })
})

describe('sweep 15: a lease, a small batch and a time budget (R3 of the second 2026-11 ship review)', () => {
  const unread = (id: string) => ({
    id,
    organizationId: 'org_1',
    projectId: 'proj_1',
    addressId: 'a1',
    stagingBucket: 'b',
    rawStorageKey: 'k',
    readerFaultAt: new Date('2026-11-03T06:00:00Z'),
    senderClass: null,
  })

  it('asks for five texts at most, leases each before it reads it, and gives each read only what is left', async () => {
    let clock = 0
    repository.findUnreadTexts.mockResolvedValueOnce(['m1', 'm2', 'm3', 'm4', 'm5'].map(unread) as never)
    // A slow reader: each read takes 15 s of the budget.
    vi.mocked(rereadHeldText).mockImplementation(async () => {
      clock += 15_000
      return 'later'
    })

    const result = await sweepUnreadTexts(new Date(), () => clock)

    expect(repository.findUnreadTexts).toHaveBeenCalledWith(expect.any(Date), REREAD_BATCH)
    expect(REREAD_BATCH).toBeLessThanOrEqual(5)
    expect(REREAD_BUDGET_MS).toBeLessThanOrEqual(60_000)
    // 45 s: reads at 0, 15 s; at 30 s only 15 s are left, under the 20 s a read may take.
    expect(vi.mocked(rereadHeldText).mock.calls.map(([mail, left]) => [mail.id, left])).toEqual([
      ['m1', REREAD_BUDGET_MS],
      ['m2', REREAD_BUDGET_MS - 15_000],
    ])
    expect(repository.leaseReread).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ checked: 5, later: 2, deferred: 3 })
  })

  it('reads nothing another run leased first', async () => {
    repository.findUnreadTexts.mockResolvedValueOnce([unread('m1'), unread('m2')] as never)
    repository.leaseReread.mockResolvedValueOnce(null as never)
    vi.mocked(rereadHeldText).mockResolvedValue('read')

    const result = await sweepUnreadTexts(new Date())

    expect(vi.mocked(rereadHeldText).mock.calls.map(([mail]) => mail.id)).toEqual(['m2'])
    // The read compares against the lease it took, not the fault the find saw.
    expect(vi.mocked(rereadHeldText).mock.calls[0][0].readerFaultAt.getTime()).toBeGreaterThan(unread('m2').readerFaultAt.getTime())
    expect(result).toMatchObject({ read: 1, gone: 1 })
  })
})
