/**
 * @vitest-environment node
 *
 * The receive job's part of the sender rule (`./receive-sender.ts`): what the
 * kill switch does to a verified writer's mail. Off, no sender job is queued,
 * and the mail waits for the project's writers, told as any held mail is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/jobs-queue/enqueue', () => ({ enqueueJobIfAbsent: vi.fn(async () => true) }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn(() => true) }))
vi.mock('./announce', () => ({ announceWaiting: vi.fn(async () => true), announceHeld: vi.fn(async () => false) }))
vi.mock('./receive-repository', () => ({ findMailForReceive: vi.fn() }))

import { captureServer } from '@/lib/analytics/posthog-server'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { enqueueJobIfAbsent } from '@/lib/jobs-queue/enqueue'
import { announceHeld, announceWaiting } from './announce'
import { findMailForReceive } from './receive-repository'
import { inboundMailJobId, queueSenderFiling } from './receive-sender'

const MAIL = {
  id: '3c2b1a00-0000-4000-8000-00000000a001',
  organizationId: 'org_01SENDER',
  projectId: '0e5b4f2e-1d7c-4c3a-9a51-2f0d8c6b7a10',
  status: 'waiting',
  senderTrust: 'member_verified',
  senderUserId: 'user_01WRITER',
  senderFlags: [],
  senderClass: 'verified_writer',
  automatic: false,
} as unknown as InboundMailRow

beforeEach(() => {
  vi.mocked(findMailForReceive).mockResolvedValue(MAIL)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('queueSenderFiling and the kill switch (INBOUND_MAIL_DIRECT_FILING)', () => {
  it('queues the sender’s filing by name while direct filing is on, and tells nobody yet', async () => {
    await queueSenderFiling(MAIL)

    expect(enqueueJobIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inbound_mail_sender_file', jobId: inboundMailJobId('sender', MAIL.id) }),
    )
    expect(announceWaiting).not.toHaveBeenCalled()
  })

  it('off, queues nothing: the mail waits for the project’s writers, who hear of it, and the run is counted', async () => {
    vi.stubEnv('INBOUND_MAIL_DIRECT_FILING', 'false')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    await queueSenderFiling(MAIL)

    expect(enqueueJobIfAbsent).not.toHaveBeenCalled()
    expect(announceWaiting).toHaveBeenCalledWith(expect.objectContaining({ mailId: MAIL.id, senderTrust: 'member_verified' }))
    expect(announceHeld).toHaveBeenCalledWith(expect.objectContaining({ senderClass: 'verified_writer' }))
    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'inbound_mail_sender_filed', properties: expect.objectContaining({ outcome: 'waits', reason: 'direct_filing_off' }) }),
    )
  })

  it('off, tells nothing about a mail a person decided meanwhile', async () => {
    vi.stubEnv('INBOUND_MAIL_DIRECT_FILING', 'false')
    vi.mocked(findMailForReceive).mockResolvedValueOnce({ ...MAIL, status: 'settled' })

    await queueSenderFiling(MAIL)

    expect(enqueueJobIfAbsent).not.toHaveBeenCalled()
    expect(announceWaiting).not.toHaveBeenCalled()
  })
})
