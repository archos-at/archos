import { afterEach, describe, expect, it, vi } from 'vitest'
import { directFilingEnabled } from './direct-filing'
import { judgeSender, type SenderAuthentication } from './sender-auth'
import {
  isVerifiedWriterEvidence,
  onlySenderReleases,
  ownClaimedMail,
  senderClassOf,
  senderReleaseOf,
  senderWaitReason,
  type ClaimedMail,
  type SenderClassInput,
  type WaitReasonInput,
} from './sender-class'

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

  it('a writer’s mail signed by the organizational domain or a subdomain (DMARC relaxed alignment) is a verified writer’s', () => {
    expect(senderClassOf(input({ flags: ['relaxed_alignment'] }))).toBe('verified_writer')
    expect(isVerifiedWriterEvidence(input({ flags: ['relaxed_alignment'] }))).toBe(true)
  })

  it('relaxed alignment keeps every other rule: a replay flag, a Bcc copy or automatic sending still waits', () => {
    expect(senderClassOf(input({ flags: ['relaxed_alignment', 'stale_date'] }))).toBe('unverified_writer')
    expect(senderClassOf(input({ flags: ['relaxed_alignment', 'not_addressed_to_project', 'bcc_own'] }))).toBe('unverified_writer')
    expect(senderClassOf(input({ flags: ['relaxed_alignment'], automatic: true }))).toBe('unverified_writer')
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
      expect(onlySenderReleases({ ...claimedBy('user_writer'), senderClass: 'verified_writer' }, 'user_colleague')).toBe(false)
      const held = { senderClass: 'verified_writer', senderTrust: 'member_verified', senderFlags: [], automatic: false } as const
      expect(senderWaitReason(held)).toBe('paused')
      expect(senderWaitReason({ ...held, directFiling: false })).toBe('paused')
      vi.stubEnv('INBOUND_MAIL_DIRECT_FILING', 'true')
      expect(senderWaitReason(held)).toBe('not_filed')
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
    expect(senderWaitReason(held({ senderClass: 'verified_writer', directFiling: true }))).toBe('not_filed')
    expect(senderWaitReason(held({ senderClass: 'verified_writer', directFiling: false }))).toBe('paused')
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
    expect(senderWaitReason(held({ senderFlags: ['relaxed_alignment'], automatic: true }))).toBe('automatic')
  })
})

const COLLEAGUE = 'user_01HZX3Y4Z5A6B7C8D9E0F1G2O1'

function claimedBy(senderUserId: string, overrides: Partial<ClaimedMail> = {}): ClaimedMail {
  return { senderClass: 'unverified_writer', senderUserId, senderTrust: 'member_unverified', senderReason: 'dkim_none', senderFlags: [], ...overrides }
}

describe('who releases a mail that claims a writer (amendment of 2026-11-19)', () => {
  it('the claimed writer releases their own mail, saying they sent it', () => {
    expect(senderReleaseOf(claimedBy(WRITER), WRITER)).toBe('own')
    expect(ownClaimedMail(claimedBy(WRITER), WRITER)).toBe(true)
    expect(onlySenderReleases(claimedBy(WRITER), WRITER)).toBe(false)
  })

  it('any other writer releases an unsigned, unaligned or replayed mail of a writer once they checked it is from them', () => {
    const cases: ClaimedMail[] = [
      claimedBy(WRITER),
      claimedBy(WRITER, { senderReason: 'dkim_unaligned' }),
      claimedBy(WRITER, { senderReason: 'dkim_expired' }),
      claimedBy(WRITER, { senderTrust: 'member_verified', senderReason: 'dkim_pass', senderFlags: ['not_addressed_to_project', 'bcc_own'] }),
      claimedBy(WRITER, { senderTrust: 'member_verified', senderReason: 'dkim_pass', senderFlags: ['stale_date'] }),
    ]
    for (const mail of cases) {
      expect(senderReleaseOf(mail, COLLEAGUE), mail.senderReason ?? '').toBe('checked_by_writer')
      expect(onlySenderReleases(mail, COLLEAGUE)).toBe(false)
      expect(ownClaimedMail(mail, COLLEAGUE)).toBe(false)
    }
  })

  it('keeps an impersonation for the member it names: a signature their domain rejected stays sender_only for everyone else', () => {
    for (const senderReason of ['dkim_fail', 'dkim_policy', 'dkim_weak_algorithm', 'dkim_short_key'] as const) {
      const rejected = claimedBy(WRITER, { senderReason })
      expect(senderReleaseOf(rejected, COLLEAGUE), senderReason).toBe('sender_only')
      expect(onlySenderReleases(rejected, COLLEAGUE)).toBe(true)
      expect(senderReleaseOf(rejected, WRITER)).toBe('own')
    }
  })

  it('keeps a mail no verdict was written for to its member: nothing to check it against', () => {
    expect(onlySenderReleases(claimedBy(WRITER, { senderTrust: null, senderReason: null }), COLLEAGUE)).toBe(true)
  })

  it('asks nothing of any other class', () => {
    for (const senderClass of ['verified_writer', 'office_member', 'external', null] as const) {
      expect(senderReleaseOf(claimedBy(WRITER, { senderClass }), COLLEAGUE)).toBeNull()
      expect(senderReleaseOf(claimedBy(WRITER, { senderClass }), WRITER)).toBeNull()
    }
  })
})

describe('a sender the receive job could not check (R14)', () => {
  it('is said to be unchecked, never an outsider nor read-only: with the directory down no impersonation check could run', () => {
    const directoryDown = { senderClass: 'external', senderTrust: 'external_verified', senderFlags: ['sender_unchecked'], automatic: false } as const
    expect(senderWaitReason(directoryDown)).toBe('sender_unchecked')
    expect(senderWaitReason({ ...directoryDown, senderClass: 'office_member', senderTrust: 'member_verified' })).toBe('sender_unchecked')
    expect(senderWaitReason({ ...directoryDown, senderFlags: [] })).toBe('outside_office')
  })
})
