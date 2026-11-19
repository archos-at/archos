import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import type { InboundMailDecisionRow, InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { domainOf } from '@/lib/mail-thread/mail-threading'
import { chatScreeningRules, maskText, type ContentScreenRules } from '@/lib/upload-screening/content-screen'
import { SCREENED_ONLY } from '@/lib/documents/visibility'
import { gatePolicy } from '@/lib/upload-screening/service'
import { candidatesFor, type ViewerCandidates } from './candidates'
import { mailIfMatch } from './decision'
import { INBOUND_MAIL_RESTORE_DAYS, type InboundSenderTrust } from './inbound-mail-vocabulary'
import type {
  InboundMailListStatus,
  InboundMailOutcome,
  InboundMailPartSuggestionView,
  InboundMailSenderFolderView,
  InboundMailSummaryView,
  InboundMailView,
} from './inbound-mail-wire'
import { findFiledVias, findFollowDeciders, findMailParts } from './repository'
import { withReviewDefaults, type InboundMailPartBase } from './review-defaults'
import { onlySenderReleases, ownClaimedMail, senderWaitReason } from './sender-class'
import { NO_FALLBACK, senderMemoryAddress, senderMemoryFallback, type SenderMemoryFallback } from './sender-memory'
import { findSenderFolders } from './sender-memory-repository'
import { readSuggestion, suggestionSkipReason } from './suggest'
import { filedTo, suggestedPlaces } from './suggested-places'
import { suggestionPending } from './suggestion-wait'

const DAY_MS = 86_400_000

export async function maskRulesFor(organizationId: string, projectId: string): Promise<ContentScreenRules | null> {
  return chatScreeningRules(await gatePolicy(organizationId, projectId))
}

export const masked = (text: string | null, rules: ContentScreenRules | null): string | null =>
  text === null ? null : maskText(text, rules).text

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString())

function listStatusOf(mail: InboundMailRow, parts: readonly InboundMailPartRow[]): InboundMailListStatus {
  const open = parts.some((part) => part.state === 'waiting' || part.state === 'filing')
  return mail.status === 'waiting' && open ? 'waiting' : 'handled'
}

function restorableUntil(mail: InboundMailRow, part: InboundMailPartRow, now: number): string | null {
  if (mail.status !== 'waiting' || (part.state !== 'dismissed' && part.state !== 'expired') || !part.endedAt) return null
  if (part.kind === 'attachment' && part.storageKey === null) return null
  const until = new Date(part.endedAt).getTime() + INBOUND_MAIL_RESTORE_DAYS * DAY_MS
  return until > now ? new Date(until).toISOString() : null
}

function suggestionOf(mail: InboundMailRow, part: InboundMailPartRow, fallback: SenderMemoryFallback): InboundMailPartSuggestionView | null {
  if (suggestionSkipReason(mail) !== null) return null
  const model = readSuggestion(part.suggestion)
  return model ? { ...model, source: 'model' } : fallback(part)
}

function partView(
  mail: InboundMailRow,
  part: InboundMailPartRow,
  candidates: ViewerCandidates,
  context: { now: number; fallback: SenderMemoryFallback },
): InboundMailPartBase {
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
    suggestion: suggestionOf(mail, part, context.fallback),
    restorableUntil: restorableUntil(mail, part, context.now),
  }
}

function mailView(
  mail: InboundMailRow,
  parts: readonly InboundMailPartRow[],
  candidates: ViewerCandidates,
  context: {
    closed: boolean
    rules: ContentScreenRules | null
    followedBy: string | null
    now: number
    viewerUserId: string
    memory: SenderMemory
  },
): InboundMailView {
  const fallback = context.memory.fallback ? senderMemoryFallback(parts, context.memory.folders) : NO_FALLBACK
  const threads = candidates.threads(mail)
  return withReviewDefaults({
    id: mail.id,
    senderClass: mail.senderClass,
    waitReason: senderWaitReason(mail),
    onlySenderReleases: onlySenderReleases(mail, context.viewerUserId),
    ownClaimedMail: ownClaimedMail(mail, context.viewerUserId),
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
    parts: parts.map((part) => partView(mail, part, candidates, { now: context.now, fallback })),
    threadCandidates: threads.shown,
    hiddenThreadCandidates: threads.hidden,
    followedBy: context.followedBy,
    senderFolders: context.memory.folders,
    updatedAt: new Date(mail.updatedAt).toISOString(),
  })
}

interface SenderMemory {
  folders: InboundMailSenderFolderView[]
  fallback: boolean
}

const NO_MEMORY: SenderMemory = { folders: [], fallback: false }

async function senderMemoryOf(session: AuthorizedSession, projectId: string, mail: InboundMailRow): Promise<SenderMemory> {
  const senderAddress = senderMemoryAddress(mail)
  if (!senderAddress) return NO_MEMORY
  const [folders, pending] = await Promise.all([
    getHiddenFolderIds(session, projectId).then((hiddenFolderIds) =>
      findSenderFolders({
        organizationId: session.organizationId,
        projectId,
        senderAddress,
        exceptMailId: mail.id,
        reader: SCREENED_ONLY,
        hiddenFolderIds,
      }),
    ),
    suggestionPending(session.organizationId, mail.id),
  ])
  return { folders, fallback: !pending }
}

export type FiledVias = ReadonlyMap<string, InboundMailDecisionRow['via']>

const WITHOUT_CLICK: ReadonlyArray<InboundMailDecisionRow['via']> = ['follow', 'sender']

function filedWithoutClick(
  parts: readonly InboundMailPartRow[],
  view: InboundMailView,
  vias: FiledVias,
): InboundMailSummaryView['filedWithoutClick'] {
  const filed = parts.filter((part) => part.state === 'filed')
  if (filed.length === 0 || !filed.every((part) => WITHOUT_CLICK.includes(vias.get(part.id) ?? 'app'))) return null
  const place = (part: InboundMailPartRow) => view.parts.find((shown) => shown.id === part.id)?.filedAs ?? null
  const text = filed.find((part) => part.kind === 'message')
  return { to: (text ? place(text) : null) ?? filed.map(place).find((shown) => shown !== null) ?? null }
}

export function summaryView(
  mail: InboundMailRow,
  parts: readonly InboundMailPartRow[],
  view: InboundMailView,
  now: number,
  vias: FiledVias = new Map(),
): InboundMailSummaryView {
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
    ownClaimedMail: view.ownClaimedMail,
    incompleteReason: view.incompleteReason,
    followedBy: view.followedBy,
    filedWithoutClick: filedWithoutClick(parts, view, vias),
    filedTo: filedTo(view),
    suggestedPlaces: suggestedPlaces(view),
    updatedAt: view.updatedAt,
  }
}

export const groupParts = (parts: readonly InboundMailPartRow[]): Map<string, InboundMailPartRow[]> => {
  const byMail = new Map<string, InboundMailPartRow[]>()
  for (const part of parts) byMail.set(part.mailId, [...(byMail.get(part.mailId) ?? []), part])
  return byMail
}

export async function loadMailViews(
  session: AuthorizedSession,
  projectId: string,
  mails: readonly InboundMailRow[],
  closed: boolean,
  options: { senderMemory?: boolean } = {},
): Promise<Array<{ mail: InboundMailRow; parts: InboundMailPartRow[]; view: InboundMailView; vias: FiledVias }>> {
  const parts = await findMailParts(mails.map((mail) => mail.id))
  const [candidates, rules, followers, vias, memories] = await Promise.all([
    candidatesFor(session, projectId, mails, parts),
    maskRulesFor(session.organizationId, projectId),
    findFollowDeciders(mails.map((mail) => mail.id)),
    findFiledVias(mails.map((mail) => mail.id)),
    Promise.all(mails.map((mail) => (options.senderMemory ? senderMemoryOf(session, projectId, mail) : NO_MEMORY))),
  ])
  const byMail = groupParts(parts)
  const now = Date.now()
  return mails.map((mail, index) => {
    const own = byMail.get(mail.id) ?? []
    const memory = memories[index] ?? NO_MEMORY
    const context = { closed, rules, followedBy: followers.get(mail.id) ?? null, now, viewerUserId: session.userId, memory }
    return { mail, parts: own, view: mailView(mail, own, candidates, context), vias }
  })
}

export async function mailViews(
  session: AuthorizedSession,
  projectId: string,
  mails: readonly InboundMailRow[],
  closed: boolean,
  options: { senderMemory?: boolean } = {},
): Promise<InboundMailView[]> {
  return (await loadMailViews(session, projectId, mails, closed, options)).map((entry) => entry.view)
}
