import 'server-only'
/**
 * The E-Mail-Eingang's notices (ADR-0137, DECISION §9 „Postfach types“, and
 * the amendment of 2026-11-03): who is told what about project mail, and when
 * a notice is settled. Eleven types, all in-app and push only (we never send
 * mail about mail, and nobody outside the office hears from us at all):
 *
 * | Type | Told to | Row | Settled |
 * |---|---|---|---|
 * | `inbound_mail.waiting` | the sender per D9 when they may write here, else the project's writers | per project | nothing waits |
 * | `inbound_mail.expiring` | the same, once per mail (sweep 4) | per project | nothing told about waits |
 * | `inbound_mail.held` | the member a mail claims whose signature did not hold („Haben Sie das gesendet?“) | per mail | the mail is decided or expires |
 * | `inbound_mail.held_for_writers` | the member without write rights whose mail waits for the writers | per mail | the mail is decided or expires |
 * | `inbound_mail.decided` | the member sender: their mail was filed (by a writer, or directly as them, `direct`) | per mail | — |
 * | `inbound_mail.rejected` | the member sender: their mail was dismissed | per mail | — |
 * | `inbound_mail.expired` | the member sender: their mail ran out unfiled | per mail | — |
 * | `inbound_mail.filing_failed` | the decider | per mail | filed again or dismissed |
 * | `inbound_mail.cap_reached` | the managers | per address | below 80%, or a new address |
 * | `inbound_mail.appended` | the follower | per Verlauf and day | — |
 * | `mail_thread.follow_expiring` | the follower, once (sweep 12) | per follow | renewed or ended |
 *
 * Who is told about a mail (D9, RT-S14, and the amendment):
 * - that it waits: the sender, when the mail is `member_verified`, addressed to
 *   the project (or the member's own Bcc copy, D4) and the member may write in
 *   the project, so may file it; otherwise the project's writers (any of
 *   `DOCUMENT_WRITE_PERMISSIONS`), who are the ones the E-Mail-Eingang lets
 *   file it. A signed mail from a member who may only read the project goes to
 *   the writers; its member hears why it waits (`held_for_writers`);
 * - why it waits, and what became of it: the member the From address names,
 *   whenever there is one and they may read the project, the forged case
 *   included. A forger thereby causes a notice to the member they
 *   impersonated: that member is the one person who can answer „Haben Sie
 *   das gesendet?“, and the row carries nothing the forger wrote.
 *
 * What a row says: the project's name, a count, a code. No sender, no subject,
 * no file name reaches a row or a push, so a stranger's words never land on a
 * lock screen (redacted by construction, RT-X1); mail from an unconfirmed
 * domain or sent automatically adds a line saying so (`unconfirmed`). A
 * decided mail names its folder only when the member may open it.
 *
 * Telling once is the caller's: the receive job marks `notified_at`, the
 * sweeps compare-and-set `expiring_notified_at` and the address's
 * `cap_notice` before telling, the filing job tells a decision when it is
 * the run that ended the mail. Best effort: the fact is stored before this
 * runs, and a lost row costs a notification, never the mail.
 */

import { isFolderVisibleToMember } from '@/lib/authz/folder-access'
import type { InboxItemType } from '@/lib/db/schema/inbox'
import { memberReader } from '@/lib/documents/document-reader'
import type {
  InboundMailCapNotice,
  InboundMailFilingFailure,
  InboundMailSenderClass,
  InboundSenderTrust,
  SenderFlag,
} from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { appendedGroupAnchor, inboxGroupKey } from '@/lib/inbox/registry'
import {
  emitInboxItems,
  openRecipientsOf,
  resolveInboxItemsAnchoredOn,
  resolveInboxItemsFor,
  type InboxEmission,
} from '@/lib/inbox/service'
import { findProjectInOrg } from '@/lib/projects/repository'
import { findThreadRow } from '@/lib/mail-thread/write-repository'
import { holds, projectManagers, projectWriters, writes } from './notice-recipients'
import { filedFolderIds, projectNoticeState } from './notice-repository'
import { findLiveFolders } from './repository'

export const INBOUND_MAIL_WAITING = 'inbound_mail.waiting' as const
export const INBOUND_MAIL_EXPIRING = 'inbound_mail.expiring' as const
export const INBOUND_MAIL_DECIDED = 'inbound_mail.decided' as const
export const INBOUND_MAIL_FILING_FAILED = 'inbound_mail.filing_failed' as const
export const INBOUND_MAIL_CAP_REACHED = 'inbound_mail.cap_reached' as const
export const INBOUND_MAIL_APPENDED = 'inbound_mail.appended' as const
export const MAIL_THREAD_FOLLOW_EXPIRING = 'mail_thread.follow_expiring' as const
export const INBOUND_MAIL_HELD = 'inbound_mail.held' as const
export const INBOUND_MAIL_HELD_FOR_WRITERS = 'inbound_mail.held_for_writers' as const
export const INBOUND_MAIL_REJECTED = 'inbound_mail.rejected' as const
export const INBOUND_MAIL_EXPIRED = 'inbound_mail.expired' as const

/** What the announcement reads of a held mail. Ids and labels only. */
export interface WaitingMail {
  organizationId: string
  projectId: string
  mailId: string
  senderTrust: InboundSenderTrust
  senderUserId: string | null
  senderFlags: readonly SenderFlag[]
  automatic: boolean
}

/**
 * Whether the mail's own sender is the one to tell (D9): a verified member's
 * mail to the project, or their own Bcc copy. Pure; whether they may write in
 * the project, and so file it, is asked by {@link waitingRecipients}.
 */
export function notifiesSender(mail: Pick<WaitingMail, 'senderTrust' | 'senderUserId' | 'senderFlags'>): boolean {
  if (mail.senderTrust !== 'member_verified' || !mail.senderUserId) return false
  return !mail.senderFlags.includes('not_addressed_to_project') || mail.senderFlags.includes('bcc_own')
}

/** Whether the row says that mail from an unconfirmed domain, or automatic mail, is among what waits. */
export function isUnconfirmed(mail: Pick<WaitingMail, 'senderTrust' | 'automatic'>): boolean {
  return mail.automatic || mail.senderTrust === 'external_unverified' || mail.senderTrust === 'member_unverified'
}

type SenderFacts = Pick<WaitingMail, 'organizationId' | 'projectId' | 'senderTrust' | 'senderUserId' | 'senderFlags'>

/** The sender, when they are the one told about the mail (D9) and may write in the project, so file it; else null. */
async function senderToTell(mail: SenderFacts): Promise<string | null> {
  if (!notifiesSender(mail) || !mail.senderUserId) return null
  return (await writes(mail.organizationId, mail.projectId, mail.senderUserId)) ? mail.senderUserId : null
}

/**
 * The member a mail's From address names, when they may read the project:
 * the one told why their mail waits and what became of it, verified or not
 * (the amendment of 2026-11-03). Null for an outsider's mail.
 */
async function memberToTell(mail: Pick<WaitingMail, 'organizationId' | 'projectId' | 'senderUserId'>): Promise<string | null> {
  if (!mail.senderUserId) return null
  return (await holds(mail.organizationId, mail.projectId, mail.senderUserId, 'project:view')) ? mail.senderUserId : null
}

/** One row about one mail for its member, named by the project only. */
async function memberRow(
  type: InboxItemType,
  mail: Pick<WaitingMail, 'organizationId' | 'projectId' | 'mailId' | 'senderUserId'>,
  extra: { anchorId?: string | null; actorUserId?: string | null; payload?: Record<string, unknown> } = {},
): Promise<InboxEmission[] | null> {
  const recipient = await memberToTell(mail)
  if (!recipient) return null
  const project = await findProjectInOrg(mail.projectId, mail.organizationId)
  if (!project) return null
  return [
    {
      organizationId: mail.organizationId,
      recipientUserId: recipient,
      type,
      resourceType: 'project',
      resourceId: mail.projectId,
      anchorId: extra.anchorId === undefined ? mail.mailId : extra.anchorId,
      actorUserId: extra.actorUserId ?? null,
      groupKey: inboxGroupKey(type, 'project', mail.projectId, mail.mailId),
      payload: { subject: project.name, ...extra.payload },
    },
  ]
}

/** A held mail and who its sender is to the project (`./sender-class.ts`). */
export interface HeldMail extends WaitingMail {
  senderClass: InboundMailSenderClass | null
}

/**
 * Tell the member a held mail names why it waits (the receive job, once per
 * mail): `inbound_mail.held` when it claims them as a writer and their
 * signature did not hold, so only they can release it; `inbound_mail.held_for_writers`
 * when they may not write in the project, or, variant `unchecked`, when
 * WorkOS never answered whether they may (`sender_unchecked`): a degraded
 * check must not tell them they have no write rights. Nothing for an
 * outsider's mail or a verified writer's (the sender job tells about that).
 * Never throws.
 */
export async function announceHeld(mail: HeldMail): Promise<boolean> {
  const type =
    mail.senderClass === 'unverified_writer' ? INBOUND_MAIL_HELD : mail.senderClass === 'office_member' ? INBOUND_MAIL_HELD_FOR_WRITERS : null
  if (!type) return false
  const unchecked = type === INBOUND_MAIL_HELD_FOR_WRITERS && mail.senderFlags.includes('sender_unchecked')
  return emit(`${type} for mail ${mail.mailId}`, mail.organizationId, () =>
    memberRow(type, mail, unchecked ? { payload: { variant: 'unchecked' } } : {}),
  )
}

/** The held notices of these mails, which no longer wait for their member: settled. Never throws. */
export async function settleHeld(organizationId: string, mailIds: readonly string[]): Promise<void> {
  await bestEffortInbox(`${INBOUND_MAIL_HELD} settled`, organizationId, async () => {
    for (const mailId of mailIds) {
      await resolveInboxItemsAnchoredOn({ organizationId, types: [INBOUND_MAIL_HELD, INBOUND_MAIL_HELD_FOR_WRITERS], anchorId: mailId })
    }
  })
}

/** A member's mail ran out unfiled (sweep 3): tell them. Never throws. */
export async function announceExpired(mail: Pick<WaitingMail, 'organizationId' | 'projectId' | 'mailId' | 'senderUserId'>): Promise<boolean> {
  return emit(`${INBOUND_MAIL_EXPIRED} for mail ${mail.mailId}`, mail.organizationId, () => memberRow(INBOUND_MAIL_EXPIRED, mail))
}

/**
 * Who is told that this mail waits: its sender (see {@link notifiesSender})
 * when they may write in the project, else the project's writers. Never only a
 * reader who cannot file it: a read-only member's signed mail would otherwise
 * tell nobody who can act, and run out unseen.
 */
export async function waitingRecipients(mail: WaitingMail): Promise<string[]> {
  const sender = await senderToTell(mail)
  return sender ? [sender] : projectWriters(mail.organizationId, mail.projectId, `mail ${mail.mailId}`)
}

/** The rows for one held mail: one per recipient, folding into the project's row. Null when the project is gone. */
export async function waitingEmissions(mail: WaitingMail, recipients: readonly string[]): Promise<InboxEmission[] | null> {
  return projectEmissions(INBOUND_MAIL_WAITING, mail, recipients)
}

/** A collapsed per-project row (`waiting`, `expiring`) for each recipient, anchored on the newest mail. */
async function projectEmissions(
  type: typeof INBOUND_MAIL_WAITING | typeof INBOUND_MAIL_EXPIRING,
  mail: WaitingMail,
  recipients: readonly string[],
): Promise<InboxEmission[] | null> {
  const project = await findProjectInOrg(mail.projectId, mail.organizationId)
  if (!project) return null
  const payload = { subject: project.name, ...(isUnconfirmed(mail) ? { variant: 'unconfirmed' } : {}) }
  return recipients.map((recipientUserId) => ({
    organizationId: mail.organizationId,
    recipientUserId,
    type,
    resourceType: 'project',
    resourceId: mail.projectId,
    anchorId: mail.mailId,
    // Nobody acted: a person's own mail still tells them it waits.
    actorUserId: null,
    groupKey: inboxGroupKey(type, 'project', mail.projectId),
    payload,
  }))
}

/** Write rows best effort; whether any was written. */
async function emit(label: string, organizationId: string, build: () => Promise<InboxEmission[] | null>): Promise<boolean> {
  let written = false
  await bestEffortInbox(label, organizationId, async () => {
    const emissions = await build()
    if (!emissions || emissions.length === 0) return
    written = (await emitInboxItems(emissions)) > 0
  })
  return written
}

/** Announce one held mail. Never throws; whether rows were written. */
export async function announceWaiting(mail: WaitingMail): Promise<boolean> {
  return emit(`${INBOUND_MAIL_WAITING} for mail ${mail.mailId}`, mail.organizationId, async () => {
    const recipients = await waitingRecipients(mail)
    return recipients.length > 0 ? waitingEmissions(mail, recipients) : null
  })
}

/**
 * Day 25 (sweep 4): the mail expires in five days. Told to whoever was told
 * it waits, in the project's collapsed row. The sweep marks the mail first, so
 * this runs once per mail. Never throws.
 */
export async function announceExpiring(mail: WaitingMail): Promise<boolean> {
  return emit(`${INBOUND_MAIL_EXPIRING} for mail ${mail.mailId}`, mail.organizationId, async () => {
    const recipients = await waitingRecipients(mail)
    return recipients.length > 0 ? projectEmissions(INBOUND_MAIL_EXPIRING, mail, recipients) : null
  })
}

/** Resolve the open rows of one group key, for everyone who holds one. */
async function settleGroup(organizationId: string, groupKey: string): Promise<number> {
  const recipients = await openRecipientsOf(organizationId, groupKey)
  if (recipients.length === 0) return 0
  return resolveInboxItemsFor(recipients.map((recipientUserId) => ({ organizationId, recipientUserId, groupKey })))
}

/**
 * Settle a project's collapsed rows that no longer describe anything: `waiting`
 * once no part of the project's mail waits for a person, `expiring` once none
 * of the mail it told about does. Called after every decision, filing, expiry
 * and settle. A row anchors on the newest mail it counts, so it is settled by
 * what the project still holds, never by the one mail that just ended. Never
 * throws.
 */
export async function settleProjectNotices(organizationId: string, projectId: string): Promise<void> {
  await bestEffortInbox(`inbound mail notices of project ${projectId}`, organizationId, async () => {
    const state = await projectNoticeState(projectId)
    if (!state.waiting) await settleGroup(organizationId, inboxGroupKey(INBOUND_MAIL_WAITING, 'project', projectId))
    if (!state.expiring) await settleGroup(organizationId, inboxGroupKey(INBOUND_MAIL_EXPIRING, 'project', projectId))
  })
}

/** A mail whose outcome its member sender is told (D9): what was decided, and by whom. */
export interface DecidedMail extends Pick<WaitingMail, 'organizationId' | 'projectId' | 'mailId' | 'senderUserId' | 'senderFlags'> {
  senderTrust: InboundSenderTrust | null
  /** The person who decided; their own mail is not news to them, unless it was filed directly. */
  decidedBy: string
  outcome: 'filed' | 'dismissed'
  /** Filed directly, as the sender, without a click (`via = 'sender'`): they are told although they are its decider. */
  direct?: boolean
}

/**
 * The one folder every filed part went to, when the member may open it: the
 * row's anchor (its link opens Dateien there) and its name. Null otherwise:
 * files in several folders, in the root, or in one the member may not see
 * (RT-S13: a folder's name is content).
 */
async function visibleFolder(mail: DecidedMail, recipient: string): Promise<{ id: string; path: string } | null> {
  if (mail.outcome !== 'filed') return null
  // As the member reads them: a file held from them by its screening names no folder.
  const folders = new Set(await filedFolderIds(mail.mailId, memberReader(recipient)))
  const [only] = [...folders]
  if (folders.size !== 1 || !only) return null
  if (!(await isFolderVisibleToMember(mail.organizationId, mail.projectId, only, recipient))) return null
  const path = (await findLiveFolders(mail.projectId, [only])).get(only)
  return path ? { id: only, path } : null
}

/**
 * A member's own mail was decided (D9, and the amendment): tell them, once.
 * Filed is `inbound_mail.decided` (`direct` when it was filed as them without
 * a click), dismissed is `inbound_mail.rejected`. The caller is the run that
 * ended the mail (the filing job when it filed the last part, the dismissal
 * when it dismissed what waited). Never the managers, never an outsider.
 * Never throws; whether a row was written.
 */
export async function announceDecided(mail: DecidedMail): Promise<boolean> {
  if (!mail.senderTrust) return false
  const type = mail.outcome === 'dismissed' ? INBOUND_MAIL_REJECTED : INBOUND_MAIL_DECIDED
  return emit(`${type} for mail ${mail.mailId}`, mail.organizationId, async () => {
    const recipient = await memberToTell(mail)
    if (!recipient) return null
    const folder = await visibleFolder(mail, recipient)
    return memberRow(type, mail, {
      // The row opens Dateien at the folder it names.
      anchorId: folder?.id ?? null,
      actorUserId: mail.direct ? null : mail.decidedBy,
      payload: { ...(mail.direct ? { variant: 'direct' } : {}), ...(folder ? { related: folder.path } : {}) },
    })
  })
}

/** A filing that made no document for some part of a mail the reader decided. */
export interface FilingFailure {
  organizationId: string
  projectId: string
  mailId: string
  /** The person who decided the filing, and whose filing failed. */
  decidedBy: string
  failure: InboundMailFilingFailure
}

/** Tell the decider their filing did not complete (the filing job, sweep 5). Never throws. */
export async function announceFilingFailed(failed: FilingFailure): Promise<boolean> {
  return emit(`${INBOUND_MAIL_FILING_FAILED} for mail ${failed.mailId}`, failed.organizationId, async () => {
    const project = await findProjectInOrg(failed.projectId, failed.organizationId)
    if (!project) return null
    return [
      {
        organizationId: failed.organizationId,
        recipientUserId: failed.decidedBy,
        type: INBOUND_MAIL_FILING_FAILED,
        resourceType: 'project',
        resourceId: failed.projectId,
        anchorId: failed.mailId,
        actorUserId: null,
        groupKey: inboxGroupKey(INBOUND_MAIL_FILING_FAILED, 'project', failed.projectId, failed.mailId),
        payload: { subject: project.name, variant: failed.failure },
      },
    ]
  })
}

/** These mails were decided again (filed or dismissed): their failed filings are no longer anyone's to do. Never throws. */
export async function settleFilingFailed(organizationId: string, mailIds: readonly string[]): Promise<void> {
  await bestEffortInbox(`${INBOUND_MAIL_FILING_FAILED} settled`, organizationId, async () => {
    for (const mailId of mailIds) {
      await resolveInboxItemsAnchoredOn({ organizationId, types: [INBOUND_MAIL_FILING_FAILED], anchorId: mailId })
    }
  })
}

/** An address that nears or reached its staged-bytes cap (D18). */
export interface CapReached {
  organizationId: string
  projectId: string
  addressId: string
  notice: InboundMailCapNotice
}

/** Tell the project's managers (the cap sweep, once per rise). Never throws. */
export async function announceCapReached(cap: CapReached): Promise<boolean> {
  return emit(`${INBOUND_MAIL_CAP_REACHED} for address ${cap.addressId}`, cap.organizationId, async () => {
    const [project, managers] = await Promise.all([
      findProjectInOrg(cap.projectId, cap.organizationId),
      projectManagers(cap.organizationId, cap.projectId, `address ${cap.addressId}`),
    ])
    if (!project) return null
    return managers.map((recipientUserId) => ({
      organizationId: cap.organizationId,
      recipientUserId,
      type: INBOUND_MAIL_CAP_REACHED,
      resourceType: 'project',
      resourceId: cap.projectId,
      anchorId: cap.addressId,
      actorUserId: null,
      groupKey: inboxGroupKey(INBOUND_MAIL_CAP_REACHED, 'project', cap.projectId, cap.addressId),
      payload: { subject: project.name, variant: cap.notice },
    }))
  })
}

/** The address is below 80% again, or was replaced: settle its rows. Never throws. */
export async function settleCapReached(organizationId: string, addressId: string): Promise<void> {
  await bestEffortInbox(`${INBOUND_MAIL_CAP_REACHED} settled`, organizationId, () =>
    resolveInboxItemsAnchoredOn({ organizationId, types: [INBOUND_MAIL_CAP_REACHED], anchorId: addressId }),
  )
}

/** A reply's text a follow appended to a Verlauf (D31), as the follower. */
export interface AppendedReply {
  organizationId: string
  projectId: string
  mailId: string
  /** The Verlauf it went into: the row points at its document. */
  threadId: string
  followerUserId: string
  /** When it was appended; its day is the row's fold. */
  at?: Date
}

/**
 * Tell the follower a reply's text went into their Verlauf (the follow job,
 * D10): one counted row per Verlauf and day, on the Verlauf's document, so its
 * link re-checks their access to it when read. Nothing when the Verlauf has no
 * document. Never throws.
 */
export async function announceAppended(reply: AppendedReply): Promise<boolean> {
  return emit(`${INBOUND_MAIL_APPENDED} for mail ${reply.mailId}`, reply.organizationId, async () => {
    const [project, thread] = await Promise.all([
      findProjectInOrg(reply.projectId, reply.organizationId),
      findThreadRow(reply.projectId, reply.threadId),
    ])
    if (!project || !thread?.documentId) return null
    return [
      {
        organizationId: reply.organizationId,
        recipientUserId: reply.followerUserId,
        type: INBOUND_MAIL_APPENDED,
        resourceType: 'document',
        resourceId: thread.documentId,
        anchorId: reply.mailId,
        // The follow acted, not the follower: their own append still tells them.
        actorUserId: null,
        groupKey: inboxGroupKey(INBOUND_MAIL_APPENDED, 'document', thread.documentId, appendedGroupAnchor(reply.at ?? new Date())),
        payload: { subject: project.name },
      },
    ]
  })
}

/** A follow that ends in five days. */
export interface ExpiringFollow {
  organizationId: string
  projectId: string
  followId: string
  threadDocumentId: string
  followerUserId: string
}

/** Day 55 (sweep 12): ask the follower to renew. The sweep marks the follow first. Never throws. */
export async function announceFollowExpiring(follow: ExpiringFollow): Promise<boolean> {
  return emit(`${MAIL_THREAD_FOLLOW_EXPIRING} for follow ${follow.followId}`, follow.organizationId, async () => {
    const project = await findProjectInOrg(follow.projectId, follow.organizationId)
    if (!project) return null
    return [
      {
        organizationId: follow.organizationId,
        recipientUserId: follow.followerUserId,
        type: MAIL_THREAD_FOLLOW_EXPIRING,
        resourceType: 'document',
        resourceId: follow.threadDocumentId,
        anchorId: follow.followId,
        actorUserId: null,
        groupKey: inboxGroupKey(MAIL_THREAD_FOLLOW_EXPIRING, 'document', follow.threadDocumentId, follow.followId),
        payload: { subject: project.name },
      },
    ]
  })
}

/** These follows were renewed or ended: their renewal is no longer asked for (D10, sweeps 9 and 12). Never throws. */
export async function settleFollowExpiring(organizationId: string, followIds: readonly string[]): Promise<void> {
  await bestEffortInbox(`${MAIL_THREAD_FOLLOW_EXPIRING} settled`, organizationId, async () => {
    for (const followId of followIds) {
      await resolveInboxItemsAnchoredOn({ organizationId, types: [MAIL_THREAD_FOLLOW_EXPIRING], anchorId: followId })
    }
  })
}

/** Every type this module writes: the E-Mail-Eingang's part of the inbox vocabulary. */
export const INBOUND_MAIL_INBOX_TYPES: readonly InboxItemType[] = [
  INBOUND_MAIL_WAITING,
  INBOUND_MAIL_EXPIRING,
  INBOUND_MAIL_DECIDED,
  INBOUND_MAIL_FILING_FAILED,
  INBOUND_MAIL_CAP_REACHED,
  INBOUND_MAIL_APPENDED,
  MAIL_THREAD_FOLLOW_EXPIRING,
  INBOUND_MAIL_HELD,
  INBOUND_MAIL_HELD_FOR_WRITERS,
  INBOUND_MAIL_REJECTED,
  INBOUND_MAIL_EXPIRED,
]
