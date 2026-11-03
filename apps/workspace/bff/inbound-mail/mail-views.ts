/**
 * A held mail as the viewer reads it (ADR-0137): the list's summary, the
 * mail's view with its parts and the viewer's candidates, and the office's
 * content check as the reader's mask. What `./service.ts` answers with.
 */

import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { domainOf } from '@/lib/mail-thread/mail-threading'
import { chatScreeningRules, maskText, type ContentScreenRules } from '@/lib/upload-screening/content-screen'
import { gatePolicy } from '@/lib/upload-screening/service'
import { candidatesFor, type ViewerCandidates } from './candidates'
import { mailIfMatch } from './decision'
import { INBOUND_MAIL_RESTORE_DAYS, type InboundSenderTrust } from './inbound-mail-vocabulary'
import type { InboundMailListStatus, InboundMailOutcome, InboundMailSummaryView, InboundMailView } from './inbound-mail-wire'
import { findFollowDeciders, findMailParts } from './repository'
import { withReviewDefaults, type InboundMailPartBase } from './review-defaults'
import { onlySenderReleases, senderWaitReason } from './sender-class'
import { readSuggestion, suggestionSkipReason } from './suggest'

const DAY_MS = 86_400_000

/** The office's content check for this project, as a reader's mask: the same rules a chat attachment is screened with. */
export async function maskRulesFor(organizationId: string, projectId: string): Promise<ContentScreenRules | null> {
  return chatScreeningRules(await gatePolicy(organizationId, projectId))
}

export const masked = (text: string | null, rules: ContentScreenRules | null): string | null =>
  text === null ? null : maskText(text, rules).text

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString())

/** Whether anything of the mail still waits for a person: the waiting list's, else the handled list's. */
function listStatusOf(mail: InboundMailRow, parts: readonly InboundMailPartRow[]): InboundMailListStatus {
  const open = parts.some((part) => part.state === 'waiting' || part.state === 'filing')
  return mail.status === 'waiting' && open ? 'waiting' : 'handled'
}

/** Until when a dismissed or expired part can be restored: only while the mail is held and its bytes are there. */
function restorableUntil(mail: InboundMailRow, part: InboundMailPartRow, now: number): string | null {
  if (mail.status !== 'waiting' || (part.state !== 'dismissed' && part.state !== 'expired') || !part.endedAt) return null
  if (part.kind === 'attachment' && part.storageKey === null) return null
  // An outsider's mail that ran out is discarded on the next sweep: nothing to restore.
  if (part.state === 'expired' && mail.senderClass === 'external') return null
  const until = new Date(part.endedAt).getTime() + INBOUND_MAIL_RESTORE_DAYS * DAY_MS
  return until > now ? new Date(until).toISOString() : null
}

function partView(mail: InboundMailRow, part: InboundMailPartRow, candidates: ViewerCandidates, now: number): InboundMailPartBase {
  const matched = candidates.part(part)
  return {
    id: part.id,
    kind: part.kind,
    position: part.position,
    filename: part.filename,
    contentType: part.contentType,
    sizeBytes: part.sizeBytes,
    state: part.state,
    scan: part.scanStatus,
    scannedAt: iso(part.scannedAt),
    riskFlags: part.riskFlags,
    nameStopTerms: part.nameStopTerms,
    contentFindings: part.contentFindings,
    offered: part.kind === 'message' || !part.riskFlags.includes('type_not_accepted'),
    lastFailure: part.lastFailure,
    documentId: part.documentId && candidates.readsDocument(part.documentId) ? part.documentId : null,
    filedAs: candidates.filedAs(part),
    duplicateOf: matched.duplicateOf,
    revisionCandidate: matched.revisionCandidate,
    revisionCandidateHidden: matched.revisionCandidateHidden,
    // A mail the agent does not suggest for shows none, even one stored before the rule said so (an impersonation).
    suggestion: suggestionSkipReason(mail) === null ? readSuggestion(part.suggestion) : null,
    restorableUntil: restorableUntil(mail, part, now),
  }
}

/** One mail as `inbound-mail-get` answers it. */
function mailView(
  mail: InboundMailRow,
  parts: readonly InboundMailPartRow[],
  candidates: ViewerCandidates,
  context: { closed: boolean; rules: ContentScreenRules | null; followedBy: string | null; now: number; viewerUserId: string },
): InboundMailView {
  const threads = candidates.threads(mail)
  return withReviewDefaults({
    id: mail.id,
    senderClass: mail.senderClass,
    // A sender the receive job could not check is not called an outsider or read-only (`./receive-faults.ts`).
    waitReason: mail.senderFlags.includes('sender_unchecked') ? 'sender_unchecked' : senderWaitReason(mail.senderClass),
    onlySenderReleases: onlySenderReleases(mail, context.viewerUserId),
    projectId: mail.projectId,
    status: listStatusOf(mail, parts),
    projectClosed: context.closed,
    ifMatch: mailIfMatch(mail, parts),
    subject: masked(mail.subject, context.rules),
    sender:
      mail.senderAddress && mail.senderTrust && mail.senderReason
        ? {
            name: mail.senderName,
            address: mail.senderAddress,
            domain: domainOf(mail.senderAddress),
            signerDomain: mail.signerDomain,
            trust: mail.senderTrust,
            reason: mail.senderReason,
            flags: mail.senderFlags,
          }
        : null,
    participants: mail.participants,
    sentAt: iso(mail.sentAt),
    receivedAt: new Date(mail.receivedAt).toISOString(),
    expiresAt: new Date(mail.expiresAt).toISOString(),
    automatic: mail.automatic,
    rawScan: mail.rawScanStatus,
    originalHeld: mail.rawStorageKey !== null,
    notStaged: mail.notStaged,
    parts: parts.map((part) => partView(mail, part, candidates, context.now)),
    threadCandidates: threads.shown,
    hiddenThreadCandidates: threads.hidden,
    followedBy: context.followedBy,
    updatedAt: new Date(mail.updatedAt).toISOString(),
  })
}

/** What a list row shows of a mail: read off the mail's own view, so the row and the detail never disagree. */
export function summaryView(mail: InboundMailRow, parts: readonly InboundMailPartRow[], view: InboundMailView, now: number): InboundMailSummaryView {
  const count = (state: InboundMailOutcome) => parts.filter((part) => part.state === state).length
  const until = parts
    .map((part) => restorableUntil(mail, part, now))
    .filter((value): value is string => value !== null)
    .sort()
  const [best] = view.threadCandidates
  return {
    id: mail.id,
    projectId: mail.projectId,
    status: view.status,
    subject: view.subject,
    senderName: mail.senderName,
    senderDomain: domainOf(mail.senderAddress),
    senderTrust: (mail.senderTrust as InboundSenderTrust | null) ?? null,
    senderFlags: mail.senderFlags,
    automatic: mail.automatic,
    receivedAt: new Date(mail.receivedAt).toISOString(),
    expiresAt: new Date(mail.expiresAt).toISOString(),
    attachments: parts.filter((part) => part.kind === 'attachment').length,
    waitingParts: parts.filter((part) => part.state === 'waiting').length,
    outcomes: { filed: count('filed'), dismissed: count('dismissed'), expired: count('expired') },
    restorableUntil: until.at(-1) ?? null,
    thread: best
      ? { threadId: best.threadId, name: best.name, nextVersion: best.nextVersion, preselected: best.preselected }
      : null,
    riskLevel: view.riskLevel,
    impersonation: view.impersonation,
    senderClass: view.senderClass,
    waitReason: view.waitReason,
    onlySenderReleases: view.onlySenderReleases,
    incompleteReason: view.incompleteReason,
    followedBy: view.followedBy,
    updatedAt: view.updatedAt,
  }
}

export const groupParts = (parts: readonly InboundMailPartRow[]): Map<string, InboundMailPartRow[]> => {
  const byMail = new Map<string, InboundMailPartRow[]>()
  for (const part of parts) byMail.set(part.mailId, [...(byMail.get(part.mailId) ?? []), part])
  return byMail
}

/** These mails as the viewer reads them, with one load of parts, candidates, followers and the mask for all of them. */
export async function loadMailViews(
  session: AuthorizedSession,
  projectId: string,
  mails: readonly InboundMailRow[],
  closed: boolean,
): Promise<Array<{ mail: InboundMailRow; parts: InboundMailPartRow[]; view: InboundMailView }>> {
  const parts = await findMailParts(mails.map((mail) => mail.id))
  const [candidates, rules, followers] = await Promise.all([
    candidatesFor(session, projectId, mails, parts),
    maskRulesFor(session.organizationId, projectId),
    findFollowDeciders(mails.map((mail) => mail.id)),
  ])
  const byMail = groupParts(parts)
  const now = Date.now()
  return mails.map((mail) => {
    const own = byMail.get(mail.id) ?? []
    const context = { closed, rules, followedBy: followers.get(mail.id) ?? null, now, viewerUserId: session.userId }
    return { mail, parts: own, view: mailView(mail, own, candidates, context) }
  })
}

export async function mailViews(
  session: AuthorizedSession,
  projectId: string,
  mails: readonly InboundMailRow[],
  closed: boolean,
): Promise<InboundMailView[]> {
  return (await loadMailViews(session, projectId, mails, closed)).map((entry) => entry.view)
}
