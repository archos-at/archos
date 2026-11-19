import { describe, expect, it } from 'vitest'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { namespaceRoot, translatorFor } from '@/i18n/namespace'
import { FOLLOW_ENDS_TOLD } from '@/lib/inbound-mail/announce'
import { INBOUND_MAIL_FILING_FAILURES } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { inboxItemCopy } from './item-copy'
import { INBOX_TYPE_DEFINITIONS } from './registry'
import { INBOX_TYPE_PRESENTATION, type InboxItemType, type InboxItemView } from './types'

const EMITTED: ReadonlyArray<[InboxItemType, ReadonlyArray<string | null>]> = [
  ['inbound_mail.waiting', [null, 'unconfirmed']],
  ['inbound_mail.expiring', [null, 'unconfirmed']],
  ['inbound_mail.decided', [null, 'dismissed']],
  ['inbound_mail.filing_failed', INBOUND_MAIL_FILING_FAILURES],
  ['inbound_mail.cap_reached', ['nearly_full', 'full']],
  ['inbound_mail.appended', [null]],
  ['mail_thread.follow_expiring', [null]],
  ['mail_thread.follow_ended', FOLLOW_ENDS_TOLD],
  ['inbound_mail.fraud_reported', [null]],
]

function view(type: InboxItemType, variant: string | null, overrides: Partial<InboxItemView> = {}): InboxItemView {
  return {
    id: 'item-1',
    type,
    state: 'unread',
    read: false,
    archived: false,
    actionable: INBOX_TYPE_DEFINITIONS[type].actionable,
    resourceType: 'project',
    resourceId: 'project-1',
    anchorId: null,
    actorName: 'Petra Huber',
    actorUserId: 'u-petra',
    count: 1,
    href: '/app/projects/project-1/files/mail',
    subject: 'Wohnbau Hietzing',
    related: null,
    excerpt: null,
    mentions: [],
    variant,
    answerIn: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
    ...overrides,
  }
}

describe.each(['de', 'en'] as const)('the E-Mail-Eingang’s notices in %s', (locale) => {
  const dictionary = namespaceRoot(collaborationCopy, locale)
  const t = translatorFor(collaborationCopy, locale)

  it.each(EMITTED.flatMap(([type, variants]) => variants.map((variant) => [type, variant] as const)))(
    '%s (%s) reads a whole sentence naming the project',
    (type, variant) => {
      for (const count of [0, 1, 3]) {
        const { title, body } = inboxItemCopy(view(type, variant, { count }), t, dictionary)
        expect(title).toContain('Wohnbau Hietzing')
        for (const text of [title, body ?? '']) {
          expect(text).not.toMatch(/[{}]|inbox\.types/)
        }
        expect(body).toBeTruthy()
      }
    },
  )

  it('words each variant it is emitted with, where the type has words for it', () => {
    const decided = inboxItemCopy(view('inbound_mail.decided', 'dismissed'), t, dictionary)
    const filed = inboxItemCopy(view('inbound_mail.decided', null), t, dictionary)
    expect(decided.title).not.toBe(filed.title)
    const full = inboxItemCopy(view('inbound_mail.cap_reached', 'full'), t, dictionary)
    const nearly = inboxItemCopy(view('inbound_mail.cap_reached', 'nearly_full'), t, dictionary)
    expect(full.title).not.toBe(nearly.title)
  })

  it('says no number and no name on a waiting row the reader can no longer reach', () => {
    const { title } = inboxItemCopy(view('inbound_mail.waiting', null, { href: null, subject: null, count: 3 }), t, dictionary)
    expect(title).not.toMatch(/\d|[{}]/)
    expect(title).not.toContain('Wohnbau Hietzing')
  })

  it('names the forged mail in a fraud warning, says what to do in the title, and nothing on a row the reader can no longer reach', () => {
    const sender = 'Miriam Huber ‹miriam.huber@mail.example›'
    const warning = inboxItemCopy(view('inbound_mail.fraud_reported', null, { related: sender, excerpt: 'Kontoänderung Honorarnote' }), t, dictionary)
    expect(warning.title).toContain(sender)
    expect(warning.title).toMatch(locale === 'de' ? /nicht zahlen, nicht antworten/ : /do not pay, do not reply/)
    expect(warning.body).toContain('Petra Huber')
    expect(warning.body).toContain(locale === 'de' ? 'Prüfen Sie Ihr Mailprogramm auf dieselbe E-Mail.' : 'Check your mail program for the same mail.')
    const gone = inboxItemCopy(view('inbound_mail.fraud_reported', null, { href: null, subject: null, related: null }), t, dictionary)
    expect(gone.title).not.toMatch(/Hietzing|[{}]/)
  })

  it('tells the member a reported mail posed as that someone used their name, not that their mail was dismissed', () => {
    const sender = 'Miriam Huber ‹miriam.huber@mail.example›'
    const reported = inboxItemCopy(view('inbound_mail.rejected', 'reported', { related: sender }), t, dictionary)
    const dismissed = inboxItemCopy(view('inbound_mail.rejected', null), t, dictionary)
    expect(reported.title).toContain('Wohnbau Hietzing')
    expect(reported.title).toContain(sender)
    expect(reported.title).not.toBe(dismissed.title)
    expect(reported.body).toContain('Petra Huber')
  })

  it('names a decided mail’s folder only when the row carries it', () => {
    const named = inboxItemCopy(view('inbound_mail.decided', null, { related: 'Behörde/Bescheide' }), t, dictionary)
    expect(named.title).toContain('Behörde/Bescheide')
    expect(inboxItemCopy(view('inbound_mail.decided', null), t, dictionary).title).not.toContain('Behörde')
  })
})

describe('the nine types’ registration', () => {
  const types = EMITTED.map(([type]) => type)

  it('are operational, never mailed, and pushed as DECISION §9 says', () => {
    const push = Object.fromEntries(types.map((type) => [type, INBOX_TYPE_DEFINITIONS[type].push]))
    expect(push).toEqual({
      'inbound_mail.waiting': { category: 'requests', urgency: 'normal' },
      'inbound_mail.expiring': { category: 'requests', urgency: 'normal' },
      'inbound_mail.decided': { category: 'results', urgency: 'low' },
      'inbound_mail.filing_failed': { category: 'requests', urgency: 'normal' },
      'inbound_mail.cap_reached': { category: 'requests', urgency: 'normal' },
      'inbound_mail.appended': { category: 'results', urgency: 'low' },
      'mail_thread.follow_expiring': { category: 'requests', urgency: 'low' },
      'mail_thread.follow_ended': { category: 'results', urgency: 'low' },
      'inbound_mail.fraud_reported': { category: 'office', urgency: 'high' },
    })
    for (const type of types) {
      expect(INBOX_TYPE_DEFINITIONS[type], type).toMatchObject({ gate: 'operational', email: { send: 'never' } })
    }
  })

  it('collapse where many mails are one thing to do, and fold per mail, address or follow otherwise', () => {
    const grouping = Object.fromEntries(types.map((type) => [type, INBOX_TYPE_DEFINITIONS[type].grouping]))
    expect(grouping).toEqual({
      'inbound_mail.waiting': 'collapse',
      'inbound_mail.expiring': 'collapse',
      'inbound_mail.decided': 'per-anchor',
      'inbound_mail.filing_failed': 'per-anchor',
      'inbound_mail.cap_reached': 'per-anchor',
      'inbound_mail.appended': 'per-anchor',
      'mail_thread.follow_expiring': 'per-anchor',
      'mail_thread.follow_ended': 'per-anchor',
      'inbound_mail.fraud_reported': 'per-anchor',
    })
  })

  it('wear an envelope each, marked with what happened, and the requests are actionable', () => {
    expect(types.map((type) => INBOX_TYPE_PRESENTATION[type].icon)).toEqual([
      'mail',
      'mail-clock',
      'mail-check',
      'mail-x',
      'mail-warning',
      'mail-plus',
      'clock',
      'mail-x',
      'shield-alert',
    ])
    expect(types.filter((type) => INBOX_TYPE_DEFINITIONS[type].actionable)).toEqual([
      'inbound_mail.waiting',
      'inbound_mail.expiring',
      'inbound_mail.filing_failed',
      'inbound_mail.cap_reached',
      'mail_thread.follow_expiring',
    ])
  })
})
