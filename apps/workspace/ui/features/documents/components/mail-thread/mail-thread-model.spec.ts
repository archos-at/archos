import { describe, expect, it } from 'vitest'
import { FIXTURE_NOW, VIEWER_ID, attachment, entry, follow, thread, versions } from '@/app/dev/mail-thread/fixtures'
import {
  attachmentLines,
  comparedVersions,
  entriesNewestFirst,
  entriesSayingTrust,
  filedSenderTrust,
  focusedEntryId,
  followRenewable,
  headingParts,
  receivedAtLabel,
  mayEndFollow,
  mayWrite,
  otherFollows,
  viewerFollow,
} from './mail-thread-model'

const DAY = 86_400_000
const iso = (offsetDays: number) => new Date(FIXTURE_NOW + offsetDays * DAY).toISOString()

describe('the viewer’s follow', () => {
  it('is found by user id, with its renewal', () => {
    const own = follow({ userId: VIEWER_ID })
    expect(viewerFollow(thread({ followed: true, follows: [follow({ userId: 'other' }), own] }), VIEWER_ID, FIXTURE_NOW)).toEqual({ kind: 'following', follow: own, renewable: true })
  })

  it('is followed without a date where the surface does not know the viewer', () => {
    expect(viewerFollow(thread({ followed: true, follows: [follow({ userId: VIEWER_ID })] }), null)).toEqual({ kind: 'following', follow: null, renewable: false })
  })

  it('is none when the server says the viewer does not follow', () => {
    expect(viewerFollow(thread({ followed: false, follows: [follow({ userId: 'other' })] }), VIEWER_ID)).toEqual({ kind: 'none' })
  })

  it('can grow while 60 days from now reach at least a day past its end, however long ago it started', () => {
    expect(followRenewable(follow({ userId: 'u', createdAt: iso(-10), expiresAt: iso(50) }), FIXTURE_NOW)).toBe(true)
    expect(followRenewable(follow({ userId: 'u', createdAt: iso(-400), expiresAt: iso(59) }), FIXTURE_NOW)).toBe(true)
    expect(followRenewable(follow({ userId: 'u', createdAt: iso(-400), expiresAt: iso(59.5) }), FIXTURE_NOW)).toBe(false)
    expect(followRenewable(follow({ userId: 'u', createdAt: iso(-10), expiresAt: iso(60) }), FIXTURE_NOW)).toBe(false)
  })
})

describe('ending someone else’s follow', () => {
  const others = follow({ userId: 'user_other' })
  it('is a manager’s only', () => {
    expect(mayEndFollow({ managesFollows: false }, others, VIEWER_ID)).toBe(false)
    expect(mayEndFollow({ managesFollows: true }, others, VIEWER_ID)).toBe(true)
  })
  it('is everybody’s for their own', () => {
    expect(mayEndFollow({ managesFollows: false }, follow({ userId: VIEWER_ID }), VIEWER_ID)).toBe(true)
  })
  it('lists the others without the viewer', () => {
    expect(otherFollows(thread({ follows: [follow({ userId: VIEWER_ID }), others] }), VIEWER_ID)).toEqual([others])
  })
})

it('reads the right to follow and detach off the waiting count', () => {
  expect(mayWrite({ waitingCount: 0 })).toBe(true)
  expect(mayWrite({ waitingCount: null })).toBe(false)
})

describe('which entry a link or a citation means', () => {
  const entries = [entry({ key: 'a', version: 1, heading: '02.10.2026, 16:40 · Miriam Huber (huber-architektur.at)' }), entry({ key: 'b', version: 2 })]
  it('by id first', () => {
    expect(focusedEntryId(entries, { entryId: entries[1].id, heading: entries[0].heading })).toBe(entries[1].id)
  })
  it('by the heading a citation prints, whatever its spaces', () => {
    expect(focusedEntryId(entries, { heading: '02.10.2026, 16:40  ·  Miriam Huber (huber-architektur.at) ' })).toBe(entries[0].id)
  })
  it('none for an old link or a section that moved away', () => {
    expect(focusedEntryId(entries, { entryId: 'gone', heading: 'nothing like it' })).toBeNull()
    expect(focusedEntryId(entries, {})).toBeNull()
  })
})

it('lists the newest mail first, keeping the document’s section order', () => {
  const entries = [entry({ key: 'a', version: 1 }), entry({ key: 'b', version: 2 }), entry({ key: 'c', version: 3 })]
  expect(entriesNewestFirst(entries).map((item) => item.id)).toEqual([entries[2].id, entries[1].id, entries[0].id])
  expect(entries[0].id).toBe(entry({ key: 'a', version: 1 }).id)
})

describe('what a mail added to the Verlauf', () => {
  it('lays the Verlauf with the mail beside the Verlauf before it', () => {
    expect(comparedVersions(entry({ key: 'b', version: 3 }), versions(4))).toEqual({
      from: { id: versions(4)[1].id, number: 2 },
      to: { id: versions(4)[2].id, number: 3 },
    })
  })

  it('nothing to compare for the first mail, a missing Fassung or bytes the reader may not open', () => {
    expect(comparedVersions(entry({ key: 'a', version: 1 }), versions(3))).toBeNull()
    expect(comparedVersions(entry({ key: 'b', version: 5 }), versions(3))).toBeNull()
    const held = versions(3).map((version) => (version.versionNumber === 1 ? { ...version, bytesReadable: false } : version))
    expect(comparedVersions(entry({ key: 'b', version: 2 }), held)).toBeNull()
  })
})

it('lists what came with a mail by position, naming nothing the reader may not see', () => {
  const lines = attachmentLines([
    attachment({ position: 3, filename: 'secret.pdf', visible: false }),
    attachment({ position: 1, filename: 'S-101_C.pdf', folderPath: 'Tragwerk/Statik' }),
    attachment({ position: 2, filename: 'x.zip', disposition: 'not_filed', notFiledReason: 'archive', documentId: undefined }),
    attachment({ position: 4, filename: 'Alt.pdf', disposition: 'already_present' }),
  ])
  expect(lines.map((line) => line.kind)).toEqual(['filed', 'not_filed', 'hidden', 'already_present'])
  expect(JSON.stringify(lines[2])).not.toContain('secret')
  expect(lines[1]).toMatchObject({ reason: 'archive' })
  expect(lines[0]).toMatchObject({ kind: 'filed', folderPath: 'Tragwerk/Statik' })
  expect(lines[3]).toMatchObject({ kind: 'already_present', folderPath: null })
})

it('says a filed sender in three words', () => {
  expect(filedSenderTrust('member_verified')).toBe('verified')
  expect(filedSenderTrust('external_verified')).toBe('verified')
  expect(filedSenderTrust('member_unverified')).toBe('unverified')
  expect(filedSenderTrust('external_unverified')).toBe('unverified')
  expect(filedSenderTrust('not_checked')).toBe('not_checked')
})

describe('where a sender’s trust is said', () => {
  const mail = (id: string, senderTrust: 'external_verified' | 'external_unverified' | 'not_checked', signerDomain: string | null) => ({ id, senderTrust, signerDomain })

  it('says a confirmed domain once per run of its mails, on the newest', () => {
    const entries = [
      mail('a', 'external_verified', 'statik-weber.at'),
      mail('b', 'external_verified', 'statik-weber.at'),
      mail('c', 'external_verified', 'wien.gv.at'),
      mail('d', 'external_verified', 'statik-weber.at'),
    ]
    expect([...entriesSayingTrust(entries)]).toEqual(['a', 'c', 'd'])
  })

  it('says an unconfirmed or unchecked sender on every mail', () => {
    const entries = [mail('a', 'external_unverified', null), mail('b', 'external_unverified', null), mail('c', 'not_checked', null), mail('d', 'not_checked', null)]
    expect([...entriesSayingTrust(entries)]).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('a heading split where it may wrap', () => {
  it('keeps the date, the name and the domain whole, and joins back to the heading exactly', () => {
    const heading = '14.10.2026, 09:12 · Mag. Huber (ma37.wien.gv.at)'
    const parts = headingParts(heading)
    expect(parts).toEqual({ when: '14.10.2026, 09:12 · ', who: 'Mag. Huber', domain: ' (ma37.wien.gv.at)' })
    expect(parts.when + parts.who + parts.domain).toBe(heading)
  })

  it('takes a heading of another shape whole', () => {
    expect(headingParts('Ohne Datum')).toEqual({ when: '', who: 'Ohne Datum', domain: '' })
    expect(headingParts('14.10.2026 · Miriam Huber')).toEqual({ when: '14.10.2026 · ', who: 'Miriam Huber', domain: '' })
  })
})

describe('when a mail arrived', () => {
  it('says it on the office’s clock, as the heading prints the sending, whatever the reader’s clock', () => {
    const sentAt = '2026-10-14T07:12:00.000Z'
    expect(receivedAtLabel({ sentAt, receivedAt: '2026-10-14T07:13:00.000Z' }, 'de-AT')).toBe('09:13')
    expect(entry({ key: 'x', version: 1, sentAt }).heading).toMatch(/^14\.10\.2026 09:12 · /)
  })

  it('gives the date too when it arrived on another day than it was sent', () => {
    expect(receivedAtLabel({ sentAt: '2026-10-14T21:50:00.000Z', receivedAt: '2026-10-15T06:02:00.000Z' }, 'de-AT')).toBe('15.10.2026, 08:02')
  })
})
