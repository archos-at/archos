/**
 * The inbox types of the E-Mail-Eingang and its Verläufe (ADR-0137, DECISION
 * §9), spread into `INBOX_TYPE_DEFINITIONS` (`./registry.ts`, which holds what
 * each field means). Every one is operational and in-app only: we never send
 * mail about mail.
 */

import type { InboxItemType } from '@/lib/db/schema/inbox'
import type { InboxEmailDefault, InboxTypeDefinition } from './registry'

/** A type's email default when it is in-app only; `./registry.ts` reads it from here, since it imports this module. */
export const IN_APP_ONLY: InboxEmailDefault = { send: 'never' }

export const INBOUND_MAIL_TYPE_DEFINITIONS = {
  /*
    Mail waits in a project's E-Mail-Eingang (ADR-0137). Actionable: nothing of
    it reaches the project until a person files it, and the badge is what says
    so. `collapse` per project: ten mails to one project are one counted row,
    not ten (a busy project gets dozens a day). Operational, since mail is not a
    chat feature. Kept 60 days, past the 30-day window and its 7-day restore.
    In-app and push only: we never send mail about mail, and the row carries no
    sender or subject, so a push shows nothing a stranger wrote.
  */
  'inbound_mail.waiting': {
    actionable: true,
    grouping: 'collapse',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  /*
    The rest of the E-Mail-Eingang's types (ADR-0137, DECISION §9). Every one
    is operational and in-app only: we never send mail about mail. None
    carries a sender, a subject or a file name, so neither a row nor a push
    shows anything a stranger wrote; each names the project.

    `expiring`: five days left (sweep 4), told once per mail to whoever was
    told it waits, collapsed per project like `waiting`. Actionable: filing
    is still the reader's to do, and the badge says so until nothing that was
    told about waits any more.
  */
  'inbound_mail.expiring': {
    actionable: true,
    grouping: 'collapse',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  /*
    A member's own verified mail was decided (D9). Per mail: two mails are two
    answers. Informational, a result like `mention.answered`, low on a device:
    nothing waits on the member.
  */
  'inbound_mail.decided': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  /*
    A filing the reader decided made no document for a part, which waits
    again (the filing job, sweep 5). Per mail. Actionable: the mail is the
    reader's to file again or dismiss, which resolves it.
  */
  'inbound_mail.filing_failed': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 60,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  /*
    An address nears or reaches its staged-bytes cap (D18), per address (the
    anchor): after a rotation the new address is a new row. Actionable for the
    managers („Adresse erneuern“, or file and dismiss what waits); resolved
    below 80%. Short retention: it states a current condition, like
    `storage.quota_warning`.
  */
  'inbound_mail.cap_reached': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'normal' },
  },
  /*
    A reply's text went into a Verlauf the reader follows (D31). One counted
    row per Verlauf and day: the group anchor is the day
    ({@link appendedGroupAnchor}), the row's anchor the newest mail, so a busy
    conversation is one row a day. Informational, a result, low.
  */
  'inbound_mail.appended': {
    actionable: false,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'results', urgency: 'low' },
  },
  /*
    The reader's follow ends in five days (sweep 12). Per follow. Actionable:
    „Verlängern“ is theirs to do; renewing or ending it resolves the row. Low
    on a device: losing a follow costs nothing but the next reply waiting.
  */
  'mail_thread.follow_expiring': {
    actionable: true,
    grouping: 'per-anchor',
    retentionDays: 30,
    gate: 'operational',
    email: IN_APP_ONLY,
    push: { category: 'requests', urgency: 'low' },
  },
} satisfies Partial<Record<InboxItemType, InboxTypeDefinition>>

/**
 * The group-key anchor of `inbound_mail.appended`: one row per Verlauf (the
 * row's resource) and UTC day, while the row's own anchor is the newest mail.
 */
export function appendedGroupAnchor(at: Date): string {
  return `day:${at.toISOString().slice(0, 10)}`
}
