// @disk-inputs: bff/inbound-mail/__fixtures__/forwards/15-outlook-forward-as-attachment-rfc822.eml
/**
 * A forward's original at receive time (migration 0195): what the row records
 * of who wrote it, and when a second forward of one original is a duplicate.
 * The parser's own cases are `original-message.spec.ts`; the database's half
 * (the unique index, the scrub) is the 0195 section of `scripts/rls-test-db.sh`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./receive-repository', () => ({ findAddressToken: vi.fn(async () => 'aaaaaaaaaaaa') }))
vi.mock('./receive-original-repository', () => ({
  isOriginalFiled: vi.fn(async () => false),
  recordOriginalFields: vi.fn(async () => undefined),
}))

import type { OriginalMessage } from './original-message'
import { isOriginalFiled, recordOriginalFields } from './receive-original-repository'
import { OPEN_ORIGINAL_INDEX, originalFieldsOf, recordOriginal } from './receive-original'

const DOMAIN = 'inbox.example.org'
const RECEIVED = new Date('2026-11-03T10:00:00Z')
const context = { receivedAt: RECEIVED, domain: DOMAIN, redact: (text: string) => text.replace(/project\+[^\s>]+/g, '[address]') }
const ATTACHED = new Uint8Array(
  readFileSync(join(__dirname, '__fixtures__', 'forwards', '15-outlook-forward-as-attachment-rfc822.eml')),
)
const MAIL = { id: 'm1', projectId: 'p1', addressId: 'a1', receivedAt: RECEIVED }

function original(overrides: Partial<OriginalMessage> = {}): OriginalMessage {
  return {
    source: 'attachment',
    from: { name: 'Mag. Anna Huber', address: 'anna.huber@ma37.wien.gv.at' },
    to: [],
    cc: [],
    subject: 'Bescheid Hubergasse 14',
    sentAt: new Date('2026-10-20T08:15:00Z'),
    sentAtText: null,
    messageId: '<ABC@ma37.wien.gv.at>',
    ...overrides,
  }
}

describe('originalFieldsOf', () => {
  it('records the author, the date, the subject, the normalized Message-ID and the source', () => {
    expect(originalFieldsOf(original(), context)).toEqual({
      originalAuthorAddress: 'anna.huber@ma37.wien.gv.at',
      originalAuthorName: 'Mag. Anna Huber',
      originalSentAt: new Date('2026-10-20T08:15:00Z'),
      originalSubject: 'Bescheid Hubergasse 14',
      originalMessageId: 'ABC@ma37.wien.gv.at',
      originalSource: 'attachment',
    })
  })

  it('keeps no Message-ID for an inline block, which has none of its own', () => {
    expect(originalFieldsOf(original({ source: 'inline', messageId: 'made@up' }), context)?.originalMessageId).toBeNull()
  })

  it('takes a date after the forward arrived as the arrival, never the future', () => {
    const later = original({ sentAt: new Date('2027-01-01T00:00:00Z') })
    expect(originalFieldsOf(later, context)?.originalSentAt).toEqual(RECEIVED)
  })

  it('names no author on the project mail domain, and redacts project addresses in names and subjects (B8)', () => {
    const ours = original({ from: { name: null, address: 'project+mail-a.aaaaaaaaaaaa@inbox.example.org' } })
    expect(originalFieldsOf(ours, context)).toBeNull()
    const named = originalFieldsOf(original({ subject: 'an project+x.bbbbbbbbbbbb@inbox.example.org' }), context)
    expect(named?.originalSubject).toBe('an [address]')
  })

  it('drops a display name that is an address and keeps the address', () => {
    const fields = originalFieldsOf(original({ from: { name: 'a@b.at', address: 'a@b.at' } }), context)
    expect(fields).toMatchObject({ originalAuthorName: null, originalAuthorAddress: 'a@b.at' })
  })
})

describe('recordOriginal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records an attached original and reads it from the real bytes', async () => {
    expect(await recordOriginal(MAIL, ATTACHED, DOMAIN)).toBe('recorded')
    expect(recordOriginalFields).toHaveBeenCalledWith('m1', expect.objectContaining({ originalSource: 'attachment' }))
  })

  it('is a duplicate when the project filed that original already, and writes nothing', async () => {
    vi.mocked(isOriginalFiled).mockResolvedValueOnce(true)
    expect(await recordOriginal(MAIL, ATTACHED, DOMAIN)).toBe('duplicate')
    expect(recordOriginalFields).not.toHaveBeenCalled()
  })

  it('is a duplicate when an open mail of the project holds it (the unique index refuses)', async () => {
    const violation = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('duplicate key'), { code: '23505', constraint_name: OPEN_ORIGINAL_INDEX }),
    })
    vi.mocked(recordOriginalFields).mockRejectedValueOnce(violation)
    expect(await recordOriginal(MAIL, ATTACHED, DOMAIN)).toBe('duplicate')
  })

  it('throws any other fault, for the queue to retry', async () => {
    vi.mocked(recordOriginalFields).mockRejectedValueOnce(new Error('connection reset'))
    await expect(recordOriginal(MAIL, ATTACHED, DOMAIN)).rejects.toThrow('connection reset')
  })

  it('records nothing for a mail that is no forward', async () => {
    const plain = new TextEncoder().encode('From: a@b.at\r\nTo: x@y.at\r\nSubject: Hallo\r\n\r\nNur Text.\r\n')
    expect(await recordOriginal(MAIL, plain, DOMAIN)).toBe('none')
    expect(recordOriginalFields).not.toHaveBeenCalled()
  })
})
