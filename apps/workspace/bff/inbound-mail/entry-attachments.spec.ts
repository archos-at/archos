/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/mail-thread/write-repository', () => ({
  decidePendingAttachment: vi.fn(async () => undefined),
  findEntryOfMail: vi.fn(async () => ({ id: 'entry-1' })),
}))
vi.mock('./review-read-repository', () => ({
  findMailParts: vi.fn(async () => []),
  findProjectMail: vi.fn(),
}))
vi.mock('./decision-repository', async () => ({
  isRestorable: (await vi.importActual<typeof import('./decision-repository')>('./decision-repository')).isRestorable,
}))

import { decidePendingAttachment, findEntryOfMail } from '@/lib/mail-thread/write-repository'
import { filePart, heldMail, MAIL_ID, PROJECT_ID, textPart } from './__fixtures__/review'
import { decideEndedAttachments } from './entry-attachments'
import { findMailParts, findProjectMail } from './review-read-repository'

const NOW = new Date('2026-11-19T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findProjectMail).mockResolvedValue(heldMail({ senderClass: 'office_member', senderFlags: [] }))
})

describe('what the Verlauf says of an attachment its text was filed before (review E, finding 6)', () => {
  it('says once a dismissed attachment can no longer be restored that it was dismissed, and an expired one that it expired', async () => {
    vi.mocked(findMailParts).mockResolvedValueOnce([
      textPart({ state: 'filed' }),
      filePart({ id: 'a', position: 1, state: 'dismissed', endedAt: daysAgo(8) }),
      filePart({ id: 'b', position: 2, state: 'expired', endedAt: daysAgo(1), storageKey: null }),
    ])
    await decideEndedAttachments(PROJECT_ID, [MAIL_ID], NOW)
    expect(decidePendingAttachment).toHaveBeenCalledWith('entry-1', 1, { disposition: 'not_filed', reason: 'dismissed' })
    expect(decidePendingAttachment).toHaveBeenCalledWith('entry-1', 2, { disposition: 'not_filed', reason: 'expired' })
    expect(decidePendingAttachment).toHaveBeenCalledTimes(2)
  })

  it('leaves an attachment that can still be restored pending: a row is decided once, and a restored part may yet be filed', async () => {
    vi.mocked(findMailParts).mockResolvedValueOnce([filePart({ position: 1, state: 'dismissed', endedAt: daysAgo(1) })])
    await decideEndedAttachments(PROJECT_ID, [MAIL_ID], NOW)
    expect(decidePendingAttachment).not.toHaveBeenCalled()
  })

  it('leaves a dismissal of an unconfirmed outsider pending too: every dismissal is restorable for seven days', async () => {
    vi.mocked(findProjectMail).mockResolvedValueOnce(heldMail({ senderClass: 'external', senderTrust: 'external_unverified', senderFlags: [] }))
    vi.mocked(findMailParts).mockResolvedValueOnce([filePart({ position: 1, state: 'dismissed', endedAt: NOW })])
    await decideEndedAttachments(PROJECT_ID, [MAIL_ID], NOW)
    expect(decidePendingAttachment).not.toHaveBeenCalled()
  })

  it('decides an expiry that is final at once, and every ended part of a settled mail', async () => {
    vi.mocked(findProjectMail).mockResolvedValueOnce(heldMail({ senderClass: 'external', senderFlags: [] }))
    vi.mocked(findMailParts).mockResolvedValueOnce([filePart({ position: 1, state: 'expired', endedAt: NOW })])
    await decideEndedAttachments(PROJECT_ID, [MAIL_ID], NOW)
    expect(decidePendingAttachment).toHaveBeenCalledWith('entry-1', 1, { disposition: 'not_filed', reason: 'expired' })

    vi.mocked(findProjectMail).mockResolvedValueOnce(heldMail({ status: 'settled' }))
    vi.mocked(findMailParts).mockResolvedValueOnce([filePart({ position: 1, state: 'dismissed', endedAt: NOW })])
    await decideEndedAttachments(PROJECT_ID, [MAIL_ID], NOW)
    expect(decidePendingAttachment).toHaveBeenLastCalledWith('entry-1', 1, { disposition: 'not_filed', reason: 'dismissed' })
  })

  it('names why a dismissed attachment could not have been filed, as an entry written after would', async () => {
    vi.mocked(findMailParts).mockResolvedValueOnce([
      filePart({ position: 1, state: 'dismissed', endedAt: daysAgo(8), scanStatus: 'infected' }),
    ])
    await decideEndedAttachments(PROJECT_ID, [MAIL_ID], NOW)
    expect(decidePendingAttachment).toHaveBeenCalledWith('entry-1', 1, { disposition: 'not_filed', reason: 'infected' })
  })

  it('writes nothing for a mail whose text has no entry, and asks once per mail', async () => {
    vi.mocked(findEntryOfMail).mockResolvedValueOnce(null)
    await decideEndedAttachments(PROJECT_ID, [MAIL_ID, MAIL_ID], NOW)
    expect(findEntryOfMail).toHaveBeenCalledTimes(1)
    expect(findMailParts).not.toHaveBeenCalled()
  })
})
