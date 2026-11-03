/**
 * The sender rule's classifier (ADR-0137, amendment of 2026-11-03): one case
 * per class, and every way a writer's mail falls short of a direct filing. The
 * database holds the same rule (`inbound_mails_verified_writer_evidence`,
 * `scripts/rls-test-db.sh`); this is the code that must never ask it for more.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { directFilingEnabled } from './direct-filing'
import { judgeSender, type SenderAuthentication } from './sender-auth'
import { isVerifiedWriterEvidence, onlySenderReleases, senderClassOf, senderWaitReason, type SenderClassInput, type WaitReasonInput } from './sender-class'

const WRITER = 'user_01HZX3Y4Z5A6B7C8D9E0F1G2H3'

const input = (overrides: Partial<SenderClassInput> = {}): SenderClassInput => ({
  trust: 'member_verified',
  reason: 'dkim_pass',
  senderUserId: WRITER,
  flags: [],
  automatic: false,
  writes: true,
  ...overrides,
})

describe('senderClassOf', () => {
  it('a writer whose domain signed the mail to the project is a verified writer', () => {
    expect(senderClassOf(input())).toBe('verified_writer')
  })

  it('a writer’s own Bcc copy waits for that writer: time cannot tell it from a recipient re-sending their mail', () => {
    expect(senderClassOf(input({ flags: ['not_addressed_to_project', 'bcc_own'] }))).toBe('unverified_writer')
    expect(isVerifiedWriterEvidence(input({ flags: ['not_addressed_to_project', 'bcc_own'] }))).toBe(false)
  })

  it('a member’s signed mail to an outsider, re-sent by that outsider to the project within 24 hours, waits', () => {
    // Signed To: the outsider, sent at 09:00; the outsider re-sends the unchanged bytes to the project at 12:00.
    const replayed: SenderAuthentication = {
      fromAddress: 'miriam@buero.example',
      fromDomain: 'buero.example',
      verified: true,
      reason: 'dkim_pass',
      signerDomain: 'buero.example',
      signedHeaders: ['from', 'to', 'subject', 'date', 'message-id'],
      signedRecipientNamesProject: false,
      authenticationResults: 'inbox.example.org; dkim=pass header.d=buero.example',
    }
    const verdict = judgeSender(replayed, {
      memberUserId: WRITER,
      receivedAt: new Date('2026-11-03T12:00:00Z'),
      sentAtHeader: new Date('2026-11-03T09:00:00Z'),
    })
    expect(verdict.flags).toEqual(['not_addressed_to_project', 'bcc_own'])
    const { trust, reason, senderUserId, flags } = verdict
    expect(senderClassOf({ trust, reason, senderUserId, flags, automatic: false, writes: true })).toBe('unverified_writer')
  })

  it('a writer’s mail without an aligned pass waits for that writer: failed, absent, or a spoofed From', () => {
    expect(senderClassOf(input({ trust: 'member_unverified', reason: 'dkim_fail' }))).toBe('unverified_writer')
    expect(senderClassOf(input({ trust: 'member_unverified', reason: 'dkim_none' }))).toBe('unverified_writer')
    expect(senderClassOf(input({ trust: 'member_unverified', reason: 'dkim_unaligned' }))).toBe('unverified_writer')
  })

  it('a writer’s signed mail with a replay or date flag, or sent automatically, waits for that writer', () => {
    for (const flag of ['stale_date', 'date_out_of_range', 'message_id_reused', 'already_filed'] as const) {
      expect(senderClassOf(input({ flags: [flag] })), flag).toBe('unverified_writer')
    }
    expect(senderClassOf(input({ flags: ['not_addressed_to_project'] }))).toBe('unverified_writer')
    expect(senderClassOf(input({ automatic: true }))).toBe('unverified_writer')
  })

  it('a writer’s mail signed by a parent or subdomain only (relaxed alignment) waits for that writer', () => {
    expect(senderClassOf(input({ flags: ['relaxed_alignment'] }))).toBe('unverified_writer')
  })

  it('an office member without write rights is an office member, signed or not', () => {
    expect(senderClassOf(input({ writes: false }))).toBe('office_member')
    expect(senderClassOf(input({ writes: false, trust: 'member_unverified', reason: 'dkim_fail' }))).toBe('office_member')
  })

  it('anyone outside the office is external, however well their domain signed', () => {
    expect(senderClassOf(input({ trust: 'external_verified', senderUserId: null }))).toBe('external')
    expect(senderClassOf(input({ trust: 'external_unverified', reason: 'dkim_none', senderUserId: null, flags: ['claims_member_name'] }))).toBe('external')
  })

  describe('the kill switch (INBOUND_MAIL_DIRECT_FILING)', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('is on unless set to false', () => {
      expect(directFilingEnabled({})).toBe(true)
      expect(directFilingEnabled({ INBOUND_MAIL_DIRECT_FILING: 'true' })).toBe(true)
      expect(directFilingEnabled({ INBOUND_MAIL_DIRECT_FILING: ' FALSE ' })).toBe(false)
    })

    it('off, a verified writer’s mail keeps its class, so any writer files it, and says why it waits', () => {
      vi.stubEnv('INBOUND_MAIL_DIRECT_FILING', 'false')
      expect(senderClassOf(input())).toBe('verified_writer')
      expect(onlySenderReleases({ senderClass: 'verified_writer', senderUserId: 'user_writer' }, 'user_colleague')).toBe(false)
      const held = { senderClass: 'verified_writer', senderTrust: 'member_verified', senderFlags: [], automatic: false } as const
      expect(senderWaitReason(held)).toBe('paused')
      expect(senderWaitReason({ ...held, directFiling: false })).toBe('paused')
      vi.stubEnv('INBOUND_MAIL_DIRECT_FILING', 'true')
      expect(senderWaitReason(held)).toBeNull()
      expect(senderClassOf(input())).toBe('verified_writer')
    })
  })

  it('names the evidence the database asks for, and nothing more', () => {
    expect(isVerifiedWriterEvidence(input())).toBe(true)
    expect(isVerifiedWriterEvidence(input({ senderUserId: null }))).toBe(false)
    expect(isVerifiedWriterEvidence(input({ reason: 'dkim_fail' }))).toBe(false)
  })
})

describe('what the class means to a reader', () => {
  const held = (overrides: Partial<WaitReasonInput> = {}): WaitReasonInput => ({
    senderClass: 'unverified_writer',
    senderTrust: 'member_verified',
    senderFlags: [],
    automatic: false,
    ...overrides,
  })

  it('says why a mail waits', () => {
    expect(senderWaitReason(held({ senderClass: 'verified_writer' }))).toBeNull()
    expect(senderWaitReason(held({ senderTrust: 'member_unverified' }))).toBe('signature')
    expect(senderWaitReason(held({ senderClass: 'office_member' }))).toBe('no_write_rights')
    expect(senderWaitReason(held({ senderClass: 'external', senderTrust: 'external_verified' }))).toBe('outside_office')
    expect(senderWaitReason(held({ senderClass: null, senderTrust: null }))).toBeNull()
  })

  it('names what held a signed writer’s mail: a replay or date flag, or automatic sending, never “the signature did not match”', () => {
    for (const flag of ['stale_date', 'date_out_of_range', 'message_id_reused', 'already_filed', 'not_addressed_to_project'] as const) {
      expect(senderWaitReason(held({ senderFlags: [flag] })), flag).toBe('replay')
    }
    expect(senderWaitReason(held({ senderFlags: ['not_addressed_to_project', 'bcc_own'] }))).toBe('replay')
    expect(senderWaitReason(held({ automatic: true }))).toBe('automatic')
    // A subdomain's key is a signature that did not come from the address's own domain.
    expect(senderWaitReason(held({ senderFlags: ['relaxed_alignment'] }))).toBe('signature')
  })

  it('lets only the claimed writer release a mail that claims them', () => {
    const claimed = { senderClass: 'unverified_writer' as const, senderUserId: WRITER }
    expect(onlySenderReleases(claimed, WRITER)).toBe(false)
    expect(onlySenderReleases(claimed, 'user_01HZX3Y4Z5A6B7C8D9E0F1G2O1')).toBe(true)
    expect(onlySenderReleases({ senderClass: 'office_member', senderUserId: WRITER }, 'user_01HZX3Y4Z5A6B7C8D9E0F1G2O1')).toBe(false)
  })
})
