import type { DocumentVersionView } from '@/lib/documents/lifecycle-types'
import { OFFICE_TIME_ZONE, formatAbsoluteTime } from '@/lib/format'
import type { SenderTrust } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import {
  MAIL_THREAD_FOLLOW_DEFAULT_DAYS,
  type MailThreadAttachmentNotFiledReason,
  type MailThreadAttachmentView,
  type MailThreadEntryView,
  type MailThreadFollowView,
  type MailThreadView,
} from '@/lib/mail-thread/mail-thread-wire'

const DAY_MS = 86_400_000

export const MAIL_ENTRY_PARAM = 'mailEntry'

export type ViewerFollow =
  | { kind: 'none' }
  | { kind: 'following'; follow: MailThreadFollowView | null; renewable: boolean }

export function followRenewable(follow: MailThreadFollowView, now: number = Date.now()): boolean {
  const renewedTo = now + MAIL_THREAD_FOLLOW_DEFAULT_DAYS * DAY_MS
  return renewedTo - Date.parse(follow.expiresAt) >= DAY_MS
}

export function viewerFollow(
  view: Pick<MailThreadView, 'followed' | 'follows'>,
  viewerUserId: string | null | undefined,
  now: number = Date.now(),
): ViewerFollow {
  const own = viewerUserId ? (view.follows.find((follow) => follow.userId === viewerUserId) ?? null) : null
  if (own) return { kind: 'following', follow: own, renewable: followRenewable(own, now) }
  if (view.followed) return { kind: 'following', follow: null, renewable: false }
  return { kind: 'none' }
}

export function otherFollows(view: Pick<MailThreadView, 'follows'>, viewerUserId: string | null | undefined): MailThreadFollowView[] {
  return view.follows.filter((follow) => follow.userId !== viewerUserId)
}

export function mayEndFollow(
  view: Pick<MailThreadView, 'managesFollows'>,
  follow: MailThreadFollowView,
  viewerUserId: string | null | undefined,
): boolean {
  return follow.userId === viewerUserId || view.managesFollows
}

export function mayWrite(view: Pick<MailThreadView, 'waitingCount'>): boolean {
  return view.waitingCount !== null
}

function normalizeHeading(heading: string): string {
  return heading.replace(/[\s  ]+/g, ' ').trim()
}

export function focusedEntryId(
  entries: readonly Pick<MailThreadEntryView, 'id' | 'heading'>[],
  target: { entryId?: string | null; heading?: string | null },
): string | null {
  if (target.entryId) {
    const byId = entries.find((entry) => entry.id === target.entryId)
    if (byId) return byId.id
  }
  if (target.heading) {
    const wanted = normalizeHeading(target.heading)
    if (wanted === '') return null
    const byHeading = entries.find((entry) => normalizeHeading(entry.heading) === wanted)
    if (byHeading) return byHeading.id
  }
  return null
}

export function entriesNewestFirst(entries: readonly MailThreadEntryView[]): MailThreadEntryView[] {
  return [...entries].reverse()
}

export function comparedVersions(
  entry: Pick<MailThreadEntryView, 'firstVersion'>,
  versions: readonly Pick<DocumentVersionView, 'id' | 'versionNumber' | 'bytesReadable'>[],
): { from: { id: string; number: number }; to: { id: string; number: number } } | null {
  const first = entry.firstVersion
  if (!first || first.number < 2) return null
  const to = versions.find((version) => version.id === first.id)
  const from = versions.find((version) => version.versionNumber === first.number - 1)
  if (!to || !from || to.bytesReadable === false || from.bytesReadable === false) return null
  return { from: { id: from.id, number: from.versionNumber }, to: { id: to.id, number: to.versionNumber } }
}

export type AttachmentLine =
  | { kind: 'hidden'; position: number }
  | { kind: 'filed' | 'already_present'; position: number; name: string; documentId: string | null; folderPath: string | null }
  | { kind: 'not_filed'; position: number; name: string; reason: MailThreadAttachmentNotFiledReason | null }

export function attachmentLines(attachments: readonly MailThreadAttachmentView[]): AttachmentLine[] {
  return [...attachments]
    .sort((a, b) => a.position - b.position)
    .map((attachment): AttachmentLine => {
      if (!attachment.visible) return { kind: 'hidden', position: attachment.position }
      const name = attachment.filename ?? ''
      if (attachment.disposition === 'not_filed') {
        return { kind: 'not_filed', position: attachment.position, name, reason: attachment.notFiledReason ?? null }
      }
      return {
        kind: attachment.disposition,
        position: attachment.position,
        name,
        documentId: attachment.documentId ?? null,
        folderPath: attachment.folderPath ?? null,
      }
    })
}

export type FiledSenderTrust = 'verified' | 'unverified' | 'not_checked'

export function filedSenderTrust(trust: SenderTrust): FiledSenderTrust {
  if (trust === 'member_verified' || trust === 'external_verified') return 'verified'
  if (trust === 'not_checked') return 'not_checked'
  return 'unverified'
}

export function entriesSayingTrust(entries: readonly Pick<MailThreadEntryView, 'id' | 'senderTrust' | 'signerDomain'>[]): Set<string> {
  const saying = new Set<string>()
  let run: string | null = null
  for (const entry of entries) {
    const verified = filedSenderTrust(entry.senderTrust) === 'verified'
    const key = verified ? `verified:${entry.signerDomain ?? ''}` : null
    if (key === null || key !== run) saying.add(entry.id)
    run = key
  }
  return saying
}

const officeDay = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: OFFICE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

export function receivedAtLabel(entry: Pick<MailThreadEntryView, 'sentAt' | 'receivedAt'>, locale: string): string {
  const at = new Date(entry.receivedAt)
  if (Number.isNaN(at.getTime())) return entry.receivedAt
  if (officeDay(entry.sentAt) === officeDay(entry.receivedAt)) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: OFFICE_TIME_ZONE }).format(at)
  }
  return formatAbsoluteTime(entry.receivedAt, locale, OFFICE_TIME_ZONE)
}

export function headingParts(heading: string): { when: string; who: string; domain: string } {
  const split = heading.indexOf(' · ')
  if (split < 0) return { when: '', who: heading, domain: '' }
  const when = heading.slice(0, split + 3)
  const rest = heading.slice(split + 3)
  const paren = rest.lastIndexOf(' (')
  if (paren < 0 || !rest.endsWith(')')) return { when, who: rest, domain: '' }
  return { when, who: rest.slice(0, paren), domain: rest.slice(paren) }
}
