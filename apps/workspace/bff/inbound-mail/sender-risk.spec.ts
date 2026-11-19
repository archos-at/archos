import { describe, expect, it } from 'vitest'
import type { SenderFlag, SenderReason, SenderTrust } from './inbound-mail-vocabulary'
import { claimedMemberIds, claimsMemberName, impersonationOf, senderNeedsAcknowledgement, senderRiskLevel, type SenderFacts } from './sender-risk'

const sender = (overrides: Partial<{ trust: SenderTrust; reason: SenderReason; flags: SenderFlag[] }> = {}): SenderFacts => ({
  trust: 'external_verified',
  reason: 'dkim_pass',
  flags: [],
  ...overrides,
})

describe('senderNeedsAcknowledgement (C2)', () => {
  it.each<[string, Parameters<typeof sender>[0], boolean]>([
    ['a confirmed stranger', {}, false],
    ['an unsigned stranger: labelled, never asked', { trust: 'external_unverified', reason: 'dkim_none' }, false],
    ['a member’s address without a signature', { trust: 'member_unverified', reason: 'dkim_none' }, true],
    ['a failed signature', { trust: 'external_unverified', reason: 'dkim_fail' }, true],
    ['a refusing policy', { trust: 'external_unverified', reason: 'dkim_policy' }, true],
    ['a key anyone can forge', { trust: 'external_unverified', reason: 'dkim_short_key' }, true],
    ['an algorithm anyone can forge', { trust: 'external_unverified', reason: 'dkim_weak_algorithm' }, true],
    ['a mail addressed to others', { flags: ['not_addressed_to_project'] }, true],
    ['the member’s own Bcc copy', { trust: 'member_verified', flags: ['not_addressed_to_project', 'bcc_own'] }, false],
    ['a date more than seven days old', { flags: ['stale_date'] }, true],
    ['a date outside the clamp only', { flags: ['date_out_of_range'] }, false],
    ['a member’s name on an outsider’s signed address', { flags: ['claims_member_name'] }, true],
    ['a member’s name on an outsider’s unsigned address', { trust: 'external_unverified', reason: 'dkim_none', flags: ['claims_member_name'] }, true],
  ])('%s → %s', (_, overrides, expected) => {
    expect(senderNeedsAcknowledgement(sender(overrides))).toBe(expected)
  })
})

describe('impersonationOf and senderRiskLevel', () => {
  it('reads „Dringend: Kontoänderung Honorarnote“ from Miriam’s address with a failed signature as an impersonation', () => {
    const forged = sender({ trust: 'member_unverified', reason: 'dkim_fail' })
    expect(impersonationOf(forged)).toBe('rejected_signature')
    expect(senderRiskLevel(forged)).toBe('impersonation')
  })

  it('reads a member’s name on another address as one, however well that domain signed', () => {
    expect(impersonationOf(sender({ flags: ['claims_member_name'] }))).toBe('member_name')
    expect(senderRiskLevel(sender({ flags: ['claims_member_name'] }))).toBe('impersonation')
  })

  it('keeps a member’s unsigned address a caution, not an alarm: most unsigned mail is a misconfigured server (RT-X6)', () => {
    expect(impersonationOf(sender({ trust: 'member_unverified', reason: 'dkim_none' }))).toBeNull()
    expect(senderRiskLevel(sender({ trust: 'member_unverified', reason: 'dkim_none' }))).toBe('caution')
    expect(senderRiskLevel(sender({ flags: ['stale_date'] }))).toBe('caution')
  })

  it('asks nothing of a confirmed or a plain unsigned stranger, nor of a settled mail', () => {
    expect(senderRiskLevel(sender())).toBe('none')
    expect(senderRiskLevel(sender({ trust: 'external_unverified', reason: 'dkim_none' }))).toBe('none')
    expect(senderRiskLevel(null)).toBe('none')
  })
})

describe('claimsMemberName', () => {
  const members = ['Miriam Huber', 'Lena', 'jo@example.com', 'Jürgen Maier']

  it.each([
    ['Miriam Huber'],
    ['Huber, Miriam'],
    ['DI Miriam Huber'],
    ['MIRIAM HUBER (Huber Architektur)'],
    ['Juergen Maier'],
    ['Jürgen  Maier'],
    ['Mi\u00ADriam Huber'],
    ['Miriam\u200B Hu\u200Dber'],
    ['\u202EMiriam Huber'],
    ['Mіriam Huber'],
    ['Мiriam Нuber'],
    ['Μiriam Ηuber'],
    ['M. Huber'],
    ['Huber, M.'],
    ['J. Maier'],
  ])('claims a member for „%s“', (name) => {
    expect(claimsMemberName(name, members)).toBe(true)
  })

  it.each([
    [null],
    [''],
    ['Miriam'],
    ['Lena'],
    ['Lena Bauer'],
    ['jo@example.com'],
    ['Miriam H.'],
    ['M. H.'],
    ['K. Huber'],
    ['Petra Weber'],
  ])('claims nobody for %s', (name) => {
    expect(claimsMemberName(name, members)).toBe(false)
  })
})

describe('claimedMemberIds', () => {
  const members = [
    { userId: 'u-miriam', name: 'Miriam Huber' },
    { userId: 'u-martin', name: 'Martin Huber' },
    { userId: 'u-juergen', name: 'Jürgen Maier' },
  ]

  it('names the members a display name claims, as claimsMemberName judges it', () => {
    expect(claimedMemberIds('DI Miriam Huber', members)).toEqual(['u-miriam'])
    expect(claimedMemberIds('M. Huber', members)).toEqual(['u-miriam', 'u-martin'])
    expect(claimedMemberIds('Petra Weber', members)).toEqual([])
    expect(claimedMemberIds(null, members)).toEqual([])
  })
})
