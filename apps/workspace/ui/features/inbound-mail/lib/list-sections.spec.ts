import { describe, expect, it } from 'vitest'
import { FIXTURE_NOW, listPage, mail, summaryOf, thread } from '@/app/dev/inbound-mail/fixtures'
import { daysUntilExpiry, isQuietMail, listSections, visibleMails, waitingShownCount } from './list-sections'

const a = summaryOf(mail({ key: 'a' }))
const b = summaryOf(mail({ key: 'b', threadCandidates: [thread({ nextVersion: 4 })] }))
const unrelated = summaryOf(mail({ key: 'c', threadCandidates: [] }))
const unconfirmed = summaryOf(mail({ key: 'd', threadCandidates: [thread({ preselected: false, blocks: ['sender_not_verified'] })] }))
const stranger = summaryOf(
  mail({
    key: 'e',
    sender: { name: null, address: 'x@clean-shine.example', domain: 'clean-shine.example', signerDomain: null, trust: 'external_unverified', reason: 'dkim_none', flags: [] },
    threadCandidates: [thread({ preselected: false, blocks: ['sender_not_verified'] })],
  })
)
const robot = summaryOf(mail({ key: 'f' }), { automatic: true })
const forged = summaryOf(mail({ key: 'g' }), { senderTrust: 'external_unverified', riskLevel: 'impersonation', impersonation: 'member_name' })

const sectionsOf = (items: typeof a[]) => listSections(items, { grouped: true, groups: listPage(items).threadGroups })

describe('listSections', () => {
  it('puts „Bereit“ first and „Braucht Sie“ second, the server’s group where the first of its mails stands', () => {
    const sections = sectionsOf([unrelated, a, unconfirmed, b, stranger, robot])
    expect(sections.map((section) => section.kind)).toEqual(['readiness', 'thread', 'readiness', 'mail', 'mail', 'mail', 'quiet'])
    expect(sections[0]).toMatchObject({ kind: 'readiness', readiness: 'ready' })
    expect(sections[0].kind === 'readiness' && sections[0].mails.map((mail) => mail.id).sort()).toEqual([a.id, b.id].sort())
    expect(sections[2]).toMatchObject({ kind: 'readiness', readiness: 'needs_you' })
    expect(sections[2].kind === 'readiness' && sections[2].mails.map((mail) => mail.id)).toEqual([unrelated.id, unconfirmed.id, stranger.id])
    const group = sections[1]
    expect(group.kind === 'thread' && [group.firstVersion, group.lastVersion]).toEqual([4, 5])
    expect(group.kind === 'thread' && group.mails.map((member) => member.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('splits a server group along readiness, so one mail that needs a person holds nothing back', () => {
    const c = summaryOf(mail({ key: 'c-ready', threadCandidates: [thread()] }))
    const held = summaryOf(mail({ key: 'held', threadCandidates: [thread()] }), { incompleteReason: 'needs_person' })
    const heldToo = summaryOf(mail({ key: 'held-too', threadCandidates: [thread()] }), { incompleteReason: 'scanning' })
    const sections = sectionsOf([a, held, b, heldToo, c])
    const groups = sections.filter((section) => section.kind === 'thread')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ firstVersion: 4, lastVersion: 6 })
    expect(groups[0].kind === 'thread' && groups[0].mails.map((mail) => mail.id)).toEqual(expect.arrayContaining([a.id, b.id, c.id]))
    expect(groups[1].kind === 'thread' && groups[1].mails.map((mail) => mail.id).sort()).toEqual([held.id, heldToo.id].sort())
    expect(sections.findIndex((section) => section === groups[0])).toBeLessThan(sections.findIndex((section) => section.kind === 'readiness' && section.readiness === 'needs_you'))
  })

  it('never counts an impersonation as „Bereit“, even when a view says it is complete', () => {
    const lying = summaryOf(mail({ key: 'lying' }), { riskLevel: 'impersonation', impersonation: 'rejected_signature', incompleteReason: null })
    const sections = sectionsOf([lying])
    expect(sections.map((section) => section.kind === 'readiness' ? section.readiness : section.kind)).toEqual(['needs_you', 'mail'])
  })

  it('never groups without the server’s group, nor a group with one mail on the page', () => {
    expect(listSections([a, b], { grouped: true }).map((section) => section.kind)).toEqual(['readiness', 'mail', 'mail'])
    const groups = listPage([a, b]).threadGroups
    expect(listSections([a], { grouped: true, groups }).map((section) => section.kind)).toEqual(['readiness', 'mail'])
  })

  it('keeps the server’s order ungrouped for the handled list', () => {
    expect(listSections([a, b, stranger], { grouped: false }).map((section) => section.kind)).toEqual(['mail', 'mail', 'mail'])
  })
})

describe('visibleMails', () => {
  it('walks every row on show, an unconfirmed stranger included, and the automatic group only while it is open', () => {
    const sections = sectionsOf([a, stranger, robot])
    expect(visibleMails(sections, false).map((mail) => mail.id)).toEqual([a.id, stranger.id])
    expect(visibleMails(sections, true).map((mail) => mail.id)).toEqual([a.id, stranger.id, robot.id])
  })
})

describe('isQuietMail', () => {
  it('folds only a machine’s mail: an unconfirmed stranger is most of a small office’s mail and stands as a row', () => {
    expect(isQuietMail(stranger)).toBe(false)
    expect(isQuietMail(robot)).toBe(true)
    expect(isQuietMail(a)).toBe(false)
  })

  it('never hides an impersonation in the collapsed group', () => {
    expect(isQuietMail(forged)).toBe(false)
  })
})

describe('waitingShownCount', () => {
  it('counts what the list shows as rows: a stranger’s mail yes, a machine’s no', () => {
    expect(waitingShownCount([a, stranger, robot, { ...b, status: 'handled' }])).toBe(2)
  })
})

describe('expiry', () => {
  const NOW = FIXTURE_NOW
  const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString()

  it('says the days left only in the last five', () => {
    expect(daysUntilExpiry({ status: 'waiting', expiresAt: inDays(5) }, NOW)).toBeNull()
    expect(daysUntilExpiry({ status: 'waiting', expiresAt: inDays(4.9) }, NOW)).toBe(4)
    expect(daysUntilExpiry({ status: 'waiting', expiresAt: inDays(0.5) }, NOW)).toBe(0)
    expect(daysUntilExpiry({ status: 'handled', expiresAt: inDays(1) }, NOW)).toBeNull()
  })

  it('moves mail about to run out to the top of its section, the rest in the server’s order', () => {
    const late = summaryOf(mail({ key: 'late', threadCandidates: [] }), { incompleteReason: 'sender', expiresAt: inDays(1) })
    const later = summaryOf(mail({ key: 'later', threadCandidates: [] }), { incompleteReason: 'sender', expiresAt: inDays(3) })
    const calm = summaryOf(mail({ key: 'calm', threadCandidates: [] }), { incompleteReason: 'sender', expiresAt: inDays(20) })
    const sections = listSections([calm, later, unrelated, late], { grouped: true, now: NOW })
    const needs = sections.find((section) => section.kind === 'readiness' && section.readiness === 'needs_you')
    expect(needs?.kind === 'readiness' && needs.mails.map((mail) => mail.id)).toEqual([late.id, later.id, calm.id, unrelated.id])
    expect(sections.filter((section) => section.kind === 'mail').map((section) => section.kind === 'mail' && section.mail.id)).toEqual([late.id, later.id, calm.id, unrelated.id])
  })
})
