/**
 * @vitest-environment node
 *
 * Sweep 15's step (`./receive-reread.ts`, B3 of the 2026-11 ship review): a
 * text held unreadable because the Python reader did not answer is read again
 * while its mail waits, never left unreadable for good; a reader still down
 * postpones it; a person who decided the text first wins; a verified writer's
 * mail gets its sender's filing queued again, by name. The SQL's
 * compare-and-set is `sweep.integration.spec.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./read-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('./read-client')>()), readMail: vi.fn() }))
vi.mock('./staging', () => ({ putStagedObject: vi.fn(async () => undefined), stagedObjectUrlForBackend: vi.fn(async () => 'http://store.test/raw') }))
vi.mock('./sweep-repository', () => ({ recordReread: vi.fn(async () => true), postponeReread: vi.fn(async () => true) }))
vi.mock('./repository', () => ({ findAddressToken: vi.fn(async () => 'abcdefgh2345') }))
vi.mock('./receive-sender', () => ({ queueSenderFiling: vi.fn(async () => undefined) }))
vi.mock('./screening', () => ({ mailScreeningFor: vi.fn(async () => ({ contentFindings: () => ['iban'] })) }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))

import { MailReadRefusedError, readMail, unreadableRead, type MailRead } from './read-client'
import { queueSenderFiling } from './receive-sender'
import { rereadHeldText } from './receive-reread'
import { putStagedObject } from './staging'
import { postponeReread, recordReread, type UnreadText } from './sweep-repository'

const NOW = new Date('2026-11-03T12:00:00Z')
const MAIL: UnreadText = {
  id: '3c2b1a00-0000-4000-8000-00000000a001',
  organizationId: 'org_01REREAD',
  projectId: '0e5b4f2e-1d7c-4c3a-9a51-2f0d8c6b7a10',
  addressId: '7a1f5c3e-8b2d-4e6f-9a0b-1c2d3e4f5a6b',
  stagingBucket: 'org-test-bucket',
  rawStorageKey: 'org/x/raw.eml',
  readerFaultAt: new Date('2026-11-03T06:00:00Z'),
  senderClass: 'verified_writer',
}
const READ: MailRead = {
  ...unreadableRead('failed'),
  bodySource: 'plain',
  ownText: 'Bitte an project+nachbar.zzzzzzzzzzzz@example.org weiterleiten.',
  unreadable: false,
  unreadableReasons: [],
}

beforeEach(() => {
  vi.stubEnv('INBOUND_MAIL_DOMAIN', 'example.org')
  vi.mocked(readMail).mockResolvedValue(READ)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('a text the reader did not answer for', () => {
  it('is read again: its read.json and text part written, redacted and checked, and its sender’s filing queued again', async () => {
    expect(await rereadHeldText(MAIL, NOW)).toBe('read')

    const [, key, body] = vi.mocked(putStagedObject).mock.calls[0]!
    expect(key).toBe(`org/${MAIL.organizationId}/project/${MAIL.projectId}/_inbound-mail/${MAIL.id}/read.json`)
    expect(Buffer.from(body).toString()).not.toContain('zzzzzzzzzzzz')
    expect(recordReread).toHaveBeenCalledWith(MAIL, expect.objectContaining({ readStorageKey: key, riskFlags: [], contentFindings: ['iban'] }))
    expect(queueSenderFiling).toHaveBeenCalledWith(MAIL)
    expect(postponeReread).not.toHaveBeenCalled()
  })

  it('waits again while the reader is still down, writing nothing', async () => {
    vi.mocked(readMail).mockRejectedValueOnce(new Error('the mail reader answered 503'))

    expect(await rereadHeldText(MAIL, NOW)).toBe('later')

    expect(postponeReread).toHaveBeenCalledWith(MAIL, NOW)
    expect(putStagedObject).not.toHaveBeenCalled()
    expect(recordReread).not.toHaveBeenCalled()
  })

  it('takes a refusal as the answer: unreadable for good, and never read again', async () => {
    vi.mocked(readMail).mockRejectedValueOnce(new MailReadRefusedError(422))

    expect(await rereadHeldText(MAIL, NOW)).toBe('read')

    expect(recordReread).toHaveBeenCalledWith(MAIL, expect.objectContaining({ riskFlags: ['unreadable'] }))
  })

  it('yields to a person who decided the text first, and queues nothing', async () => {
    vi.mocked(recordReread).mockResolvedValueOnce(false)

    expect(await rereadHeldText(MAIL, NOW)).toBe('gone')

    expect(queueSenderFiling).not.toHaveBeenCalled()
  })

  it('queues no sender’s filing for a mail that is not a verified writer’s', async () => {
    expect(await rereadHeldText({ ...MAIL, senderClass: 'external' }, NOW)).toBe('read')

    expect(queueSenderFiling).not.toHaveBeenCalled()
  })
})
