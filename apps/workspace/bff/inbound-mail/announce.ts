import 'server-only'

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

export interface WaitingMail {
  organizationId: string
  projectId: string
  mailId: string
  senderTrust: InboundSenderTrust
  senderUserId: string | null
  senderFlags: readonly SenderFlag[]
  automatic: boolean
}

export function notifiesSender(mail: Pick<WaitingMail, 'senderTrust' | 'senderUserId' | 'senderFlags'>): boolean {
  if (mail.senderTrust !== 'member_verified' || !mail.senderUserId) return false
  return !mail.senderFlags.includes('not_addressed_to_project') || mail.senderFlags.includes('bcc_own')
}

export function isUnconfirmed(mail: Pick<WaitingMail, 'senderTrust' | 'automatic'>): boolean {
  return mail.automatic || mail.senderTrust === 'external_unverified' || mail.senderTrust === 'member_unverified'
}

type SenderFacts = Pick<WaitingMail, 'organizationId' | 'projectId' | 'senderTrust' | 'senderUserId' | 'senderFlags'>

async function senderToTell(mail: SenderFacts): Promise<string | null> {
  if (!notifiesSender(mail) || !mail.senderUserId) return null
  return (await writes(mail.organizationId, mail.projectId, mail.senderUserId)) ? mail.senderUserId : null
}

async function memberToTell(mail: Pick<WaitingMail, 'organizationId' | 'projectId' | 'senderUserId'>): Promise<string | null> {
  if (!mail.senderUserId) return null
  return (await holds(mail.organizationId, mail.projectId, mail.senderUserId, 'project:view')) ? mail.senderUserId : null
}

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

export interface HeldMail extends WaitingMail {
  senderClass: InboundMailSenderClass | null
}

export async function announceHeld(mail: HeldMail): Promise<boolean> {
  const type =
    mail.senderClass === 'unverified_writer' ? INBOUND_MAIL_HELD : mail.senderClass === 'office_member' ? INBOUND_MAIL_HELD_FOR_WRITERS : null
  if (!type) return false
  const unchecked = type === INBOUND_MAIL_HELD_FOR_WRITERS && mail.senderFlags.includes('sender_unchecked')
  return emit(`${type} for mail ${mail.mailId}`, mail.organizationId, () =>
    memberRow(type, mail, unchecked ? { payload: { variant: 'unchecked' } } : {}),
  )
}

export async function settleHeld(organizationId: string, mailIds: readonly string[]): Promise<void> {
  await bestEffortInbox(`${INBOUND_MAIL_HELD} settled`, organizationId, async () => {
    for (const mailId of mailIds) {
      await resolveInboxItemsAnchoredOn({ organizationId, types: [INBOUND_MAIL_HELD, INBOUND_MAIL_HELD_FOR_WRITERS], anchorId: mailId })
    }
  })
}

export async function announceExpired(mail: Pick<WaitingMail, 'organizationId' | 'projectId' | 'mailId' | 'senderUserId'>): Promise<boolean> {
  return emit(`${INBOUND_MAIL_EXPIRED} for mail ${mail.mailId}`, mail.organizationId, () => memberRow(INBOUND_MAIL_EXPIRED, mail))
}

export async function waitingRecipients(mail: WaitingMail): Promise<string[]> {
  const sender = await senderToTell(mail)
  return sender ? [sender] : projectWriters(mail.organizationId, mail.projectId, `mail ${mail.mailId}`)
}

export async function waitingEmissions(mail: WaitingMail, recipients: readonly string[]): Promise<InboxEmission[] | null> {
  return projectEmissions(INBOUND_MAIL_WAITING, mail, recipients)
}

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
    actorUserId: null,
    groupKey: inboxGroupKey(type, 'project', mail.projectId),
    payload,
  }))
}

async function emit(label: string, organizationId: string, build: () => Promise<InboxEmission[] | null>): Promise<boolean> {
  let written = false
  await bestEffortInbox(label, organizationId, async () => {
    const emissions = await build()
    if (!emissions || emissions.length === 0) return
    written = (await emitInboxItems(emissions)) > 0
  })
  return written
}

export async function announceWaiting(mail: WaitingMail): Promise<boolean> {
  return emit(`${INBOUND_MAIL_WAITING} for mail ${mail.mailId}`, mail.organizationId, async () => {
    const recipients = await waitingRecipients(mail)
    return recipients.length > 0 ? waitingEmissions(mail, recipients) : null
  })
}

export async function announceExpiring(mail: WaitingMail): Promise<boolean> {
  return emit(`${INBOUND_MAIL_EXPIRING} for mail ${mail.mailId}`, mail.organizationId, async () => {
    const recipients = await waitingRecipients(mail)
    return recipients.length > 0 ? projectEmissions(INBOUND_MAIL_EXPIRING, mail, recipients) : null
  })
}

async function settleGroup(organizationId: string, groupKey: string): Promise<number> {
  const recipients = await openRecipientsOf(organizationId, groupKey)
  if (recipients.length === 0) return 0
  return resolveInboxItemsFor(recipients.map((recipientUserId) => ({ organizationId, recipientUserId, groupKey })))
}

export async function settleProjectNotices(organizationId: string, projectId: string): Promise<void> {
  await bestEffortInbox(`inbound mail notices of project ${projectId}`, organizationId, async () => {
    const state = await projectNoticeState(projectId)
    if (!state.waiting) await settleGroup(organizationId, inboxGroupKey(INBOUND_MAIL_WAITING, 'project', projectId))
    if (!state.expiring) await settleGroup(organizationId, inboxGroupKey(INBOUND_MAIL_EXPIRING, 'project', projectId))
  })
}

export interface DecidedMail extends Pick<WaitingMail, 'organizationId' | 'projectId' | 'mailId' | 'senderUserId' | 'senderFlags'> {
  senderTrust: InboundSenderTrust | null
  decidedBy: string
  outcome: 'filed' | 'dismissed'
  direct?: boolean
}

async function visibleFolder(mail: DecidedMail, recipient: string): Promise<{ id: string; path: string } | null> {
  if (mail.outcome !== 'filed') return null
  const folders = new Set(await filedFolderIds(mail.mailId, memberReader(recipient)))
  const [only] = [...folders]
  if (folders.size !== 1 || !only) return null
  if (!(await isFolderVisibleToMember(mail.organizationId, mail.projectId, only, recipient))) return null
  const path = (await findLiveFolders(mail.projectId, [only])).get(only)
  return path ? { id: only, path } : null
}

export async function announceDecided(mail: DecidedMail): Promise<boolean> {
  if (!mail.senderTrust) return false
  const type = mail.outcome === 'dismissed' ? INBOUND_MAIL_REJECTED : INBOUND_MAIL_DECIDED
  return emit(`${type} for mail ${mail.mailId}`, mail.organizationId, async () => {
    const recipient = await memberToTell(mail)
    if (!recipient) return null
    const folder = await visibleFolder(mail, recipient)
    return memberRow(type, mail, {
      anchorId: folder?.id ?? null,
      actorUserId: mail.direct ? null : mail.decidedBy,
      payload: { ...(mail.direct ? { variant: 'direct' } : {}), ...(folder ? { related: folder.path } : {}) },
    })
  })
}

export interface FilingFailure {
  organizationId: string
  projectId: string
  mailId: string
  decidedBy: string
  failure: InboundMailFilingFailure
}

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

export async function settleFilingFailed(organizationId: string, mailIds: readonly string[]): Promise<void> {
  await bestEffortInbox(`${INBOUND_MAIL_FILING_FAILED} settled`, organizationId, async () => {
    for (const mailId of mailIds) {
      await resolveInboxItemsAnchoredOn({ organizationId, types: [INBOUND_MAIL_FILING_FAILED], anchorId: mailId })
    }
  })
}

export interface CapReached {
  organizationId: string
  projectId: string
  addressId: string
  notice: InboundMailCapNotice
}

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

export async function settleCapReached(organizationId: string, addressId: string): Promise<void> {
  await bestEffortInbox(`${INBOUND_MAIL_CAP_REACHED} settled`, organizationId, () =>
    resolveInboxItemsAnchoredOn({ organizationId, types: [INBOUND_MAIL_CAP_REACHED], anchorId: addressId }),
  )
}

export interface AppendedReply {
  organizationId: string
  projectId: string
  mailId: string
  threadId: string
  followerUserId: string
  at?: Date
}

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
        actorUserId: null,
        groupKey: inboxGroupKey(INBOUND_MAIL_APPENDED, 'document', thread.documentId, appendedGroupAnchor(reply.at ?? new Date())),
        payload: { subject: project.name },
      },
    ]
  })
}

export interface ExpiringFollow {
  organizationId: string
  projectId: string
  followId: string
  threadDocumentId: string
  followerUserId: string
}

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

export async function settleFollowExpiring(organizationId: string, followIds: readonly string[]): Promise<void> {
  await bestEffortInbox(`${MAIL_THREAD_FOLLOW_EXPIRING} settled`, organizationId, async () => {
    for (const followId of followIds) {
      await resolveInboxItemsAnchoredOn({ organizationId, types: [MAIL_THREAD_FOLLOW_EXPIRING], anchorId: followId })
    }
  })
}

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
