import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireFolderWrite } from '@/lib/authz/folder-access'
import type { InboundMailPartRow, InboundMailRow, NewInboundMailDecisionRow } from '@/lib/db/schema/inbound-mail'
import { isAcceptedType } from '@/lib/documents/accepted-types'
import { documentNameKey } from '@/lib/documents/name-match'
import { appendNeedsAcknowledgement } from '@/lib/mail-thread/mail-threading'
import { MAIL_THREAD_MAX_ENTRIES } from '@/lib/mail-thread/mail-thread-vocabulary'
import { normalizeFolderPath } from '@/lib/projects/folders'
import { senderEvidenceOf, threadIsFull, type ViewerCandidates } from './candidates'
import type { InboundMailRefusal } from './inbound-mail-wire'
import type { InboundMailDecision, InboundMailPartDecision } from './inbound-mail-wire'
import type { DecisionActor } from './repository'
import { findDocumentIdByStoredName, type CandidateDocument, type ThreadDocument } from './repository'
import { revisionVouchedInThread } from './review-defaults'
import { onlySenderReleases } from './sender-class'
import { senderFactsOf, senderNeedsAcknowledgement as needsAcknowledgement } from './sender-risk'

export const THREAD_DOCUMENT_TYPE = 'correspondence' as const

const ACKNOWLEDGED_RISK_FLAGS = ['macro', 'type_mismatch'] as const

export function refusal(
  reason: InboundMailRefusal,
  message: string,
  details: Record<string, string | string[] | number> = {},
): ConflictError {
  return new ConflictError(message, { reason, ...details })
}

export function refusedPartOf(error: unknown): string | null {
  if (!(error instanceof ConflictError)) return null
  const details = (error as { details?: { partId?: unknown } }).details
  return typeof details?.partId === 'string' ? details.partId : null
}

export function mailIfMatch(
  mail: Pick<InboundMailRow, 'id' | 'status' | 'updatedAt'>,
  parts: ReadonlyArray<Pick<InboundMailPartRow, 'id' | 'state' | 'scanStatus' | 'lastFailure' | 'updatedAt'>>,
): string {
  const facts = [
    mail.id,
    mail.status,
    new Date(mail.updatedAt).toISOString(),
    ...[...parts]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((part) => `${part.id}:${part.state}:${part.scanStatus}:${part.lastFailure ?? ''}:${new Date(part.updatedAt).toISOString()}`),
  ]
  return createHash('sha256').update(facts.join('\n')).digest('base64url').slice(0, 27)
}

export function senderNeedsAcknowledgement(
  mail: Pick<InboundMailRow, 'senderTrust' | 'senderReason' | 'senderFlags' | 'senderClass'>,
): boolean {
  if (mail.senderClass === 'unverified_writer') return true
  const facts = senderFactsOf(mail)
  return facts === null || needsAcknowledgement(facts)
}

export interface DecisionContext {
  actor: DecisionActor
  bulk: boolean
  acceptedTypes: readonly string[]
  nameStops(filename: string, folderPath: string | null): string[]
  candidates: ViewerCandidates
  folders: ReadonlyMap<string, string>
  threads: ReadonlyMap<string, ThreadDocument>
  documents: ReadonlyMap<string, CandidateDocument>
}

export interface PlannedMailDecision {
  mailId: string
  ifMatch: string
  files: NewInboundMailDecisionRow[]
  writeFolders: Array<string | null>
  freshNames: Array<{ partId: string; storedName: string }>
}

const refuseRisk = (partId: string, flag: string) =>
  refusal('risk_not_acknowledged', `Filing this part needs its risk accepted (${flag}): add its id to acknowledgeRisk`, {
    partId,
    flag,
  })

function folderTarget(
  target: { folderId: string | null; newFolderPath: string | null },
  context: DecisionContext,
): { folderId: string | null; folderPath: string } {
  if (target.folderId) {
    const path = context.folders.get(target.folderId)
    if (path === undefined || !context.candidates.readsFolder(target.folderId)) {
      throw refusal('target_unknown', 'The folder was not found', { folderId: target.folderId })
    }
    return { folderId: target.folderId, folderPath: path }
  }
  return { folderId: null, folderPath: normalizeFolderPath(target.newFolderPath) }
}

function requireNamePasses(
  name: string,
  folderPath: string,
  released: boolean,
  partId: string,
  context: DecisionContext,
): void {
  const terms = context.nameStops(name, folderPath || null)
  if (terms.length > 0 && !released) {
    throw refusal('name_stop', 'The name check stopped this name; file it under another name or release it (screeningRelease)', {
      partId,
      terms,
    })
  }
}

function planAttachment(
  mail: InboundMailRow,
  part: InboundMailPartRow,
  decision: InboundMailPartDecision,
  acknowledgedRisk: ReadonlySet<string>,
  context: DecisionContext,
): { row: NewInboundMailDecisionRow; writeFolder: string | null; freshName: string | null } {
  if (part.scanStatus !== 'clean') throw refusal('scan_not_clean', 'This attachment has no clean scan', { partId: part.id })
  if (part.riskFlags.includes('type_not_accepted') || !isAcceptedType(decision.name, context.acceptedTypes)) {
    throw refusal('type_not_accepted', 'The office does not file this file type', { partId: part.id })
  }
  for (const flag of ACKNOWLEDGED_RISK_FLAGS) {
    if (part.riskFlags.includes(flag) && !acknowledgedRisk.has(part.id)) throw refuseRisk(part.id, flag)
  }

  let target: { folderId: string | null; folderPath: string }
  if (decision.revisionOf) {
    const earlier = context.documents.get(decision.revisionOf)
    if (!earlier || !context.candidates.readsFolder(earlier.folderId)) {
      throw refusal('target_unknown', 'The document to file a new Fassung of was not found', { partId: part.id })
    }
    const vouched = revisionVouchedInThread(part, senderFactsOf(mail), context.candidates.threads(mail).shown)
    if (!vouched && !acknowledgedRisk.has(part.id)) throw refuseRisk(part.id, 'unverified_thread')
    target = { folderId: earlier.folderId, folderPath: earlier.folderPath ?? '' }
  } else {
    target = folderTarget(decision, context)
  }
  requireNamePasses(decision.name, target.folderPath, decision.screeningRelease === 'name', part.id, context)

  return {
    row: {
      ...baseRow(mail, part.id, context.actor),
      folderId: target.folderId,
      folderPath: target.folderPath,
      fileName: decision.name,
      targetDocumentId: decision.revisionOf ?? null,
      documentType: decision.documentType ?? null,
      screeningRelease: decision.screeningRelease === 'name',
      acknowledgedRisk: acknowledgedRisk.has(part.id),
    },
    writeFolder: target.folderId,
    freshName: decision.revisionOf ? null : documentNameKey(decision.name),
  }
}

function planMessage(
  mail: InboundMailRow,
  part: InboundMailPartRow,
  message: NonNullable<InboundMailDecision['message']>,
  acknowledgedRisk: ReadonlySet<string>,
  context: DecisionContext,
): { row: NewInboundMailDecisionRow; writeFolder: string | null } {
  if (!mail.readStorageKey || part.riskFlags.includes('unreadable')) {
    throw refusal('unreadable', 'The text of this mail could not be read; download its original instead', { partId: part.id })
  }
  if (mail.rawScanStatus !== 'clean') {
    throw refusal('scan_not_clean', 'This mail has no clean scan, so its text cannot be filed; dismiss it', { partId: part.id })
  }
  if (message.text === 'masked' && part.contentFindings.length === 0) {
    throw refusal('nothing_to_mask', 'The content check found nothing to mask in this text; file it as "full"', { partId: part.id })
  }
  const base = { ...baseRow(mail, part.id, context.actor), messageText: message.text, documentType: THREAD_DOCUMENT_TYPE }

  if (message.thread.action === 'append') {
    const threadId = message.thread.mailThreadId
    const thread = context.threads.get(threadId)
    if (!thread || !context.candidates.readsFolder(thread.folderId)) {
      throw refusal('target_unknown', 'The mail thread was not found', { partId: part.id, mailThreadId: threadId })
    }
    if (threadIsFull(thread)) {
      throw refusal('thread_full', 'The mail thread is full; file the message as a new thread that continues it', {
        partId: part.id,
        mailThreadId: threadId,
      })
    }
    const match = mail.threadMatch.find((candidate) => candidate.threadId === threadId)
    if (appendNeedsAcknowledgement(senderEvidenceOf(mail), match, thread) && !acknowledgedRisk.has(part.id)) {
      throw refuseRisk(part.id, 'unverified_thread')
    }
    return {
      row: { ...base, threadAction: 'append', mailThreadId: threadId, acknowledgedRisk: acknowledgedRisk.has(part.id) },
      writeFolder: thread.folderId,
    }
  }

  const target = folderTarget(message.thread, context)
  const released = message.thread.screeningRelease === 'name'
  requireNamePasses(message.thread.name, target.folderPath, released, part.id, context)
  return {
    row: {
      ...base,
      threadAction: 'create',
      folderId: target.folderId,
      folderPath: target.folderPath,
      fileName: message.thread.name,
      screeningRelease: released,
      acknowledgedRisk: acknowledgedRisk.has(part.id),
    },
    writeFolder: target.folderId,
  }
}

function baseRow(
  mail: Pick<InboundMailRow, 'id' | 'organizationId' | 'projectId'>,
  partId: string,
  actor: DecisionActor,
): NewInboundMailDecisionRow {
  return {
    id: randomUUID(),
    organizationId: mail.organizationId,
    projectId: mail.projectId,
    mailId: mail.id,
    partId,
    action: 'file',
    decidedBy: actor.decidedBy,
    via: actor.via,
    proposalId: actor.proposalId,
  }
}

function waitingPart(parts: ReadonlyMap<string, InboundMailPartRow>, partId: string, kind: 'message' | 'attachment'): InboundMailPartRow {
  const part = parts.get(partId)
  if (!part || part.kind !== kind) throw refusal('part_unknown', `No ${kind} part of this mail has this id`, { partId })
  if (part.state !== 'waiting') throw refusal('part_not_waiting', 'This part is no longer waiting; read the mail again', { partId })
  return part
}

export function planMailDecision(
  mail: InboundMailRow,
  parts: readonly InboundMailPartRow[],
  decision: InboundMailDecision,
  context: DecisionContext,
): PlannedMailDecision {
  if (mail.status !== 'waiting' || mailIfMatch(mail, parts) !== decision.ifMatch) {
    throw refusal('stale', 'The mail changed since it was read; read it again and decide again', { mailId: mail.id })
  }
  const acknowledged = Boolean(decision.acknowledgeSender) || (decision.acknowledgeRisk?.length ?? 0) > 0
  if (acknowledged && context.bulk) {
    throw refusal('acknowledgement_in_bulk', 'Acknowledgements are a single mail’s decision; decide this mail on its own', {
      mailId: mail.id,
    })
  }
  const released =
    decision.parts.some((part) => part.screeningRelease) ||
    (decision.message?.thread.action === 'create' && decision.message.thread.screeningRelease !== undefined)
  if ((context.actor.via === 'agent_proposal' || context.actor.via === 'sender') && (acknowledged || released)) {
    throw refusal('card_carries_acknowledgement', 'A card the agent proposed files clean, unflagged parts only; the person decides the rest', {
      mailId: mail.id,
    })
  }
  if (onlySenderReleases(mail, context.actor.decidedBy) && (decision.parts.length > 0 || decision.message)) {
    throw refusal('sender_only', 'This mail claims another member as its sender; only that member can file it. You can dismiss it', {
      mailId: mail.id,
    })
  }

  const byId = new Map(parts.map((part) => [part.id, part]))
  const acknowledgedRisk = new Set(decision.acknowledgeRisk ?? [])
  const files: NewInboundMailDecisionRow[] = []
  const writeFolders: Array<string | null> = []
  const freshNames: PlannedMailDecision['freshNames'] = []
  for (const partDecision of decision.parts) {
    const part = waitingPart(byId, partDecision.partId, 'attachment')
    const planned = planAttachment(mail, part, partDecision, acknowledgedRisk, context)
    files.push(planned.row)
    writeFolders.push(planned.writeFolder)
    if (planned.freshName) freshNames.push({ partId: part.id, storedName: planned.freshName })
  }
  if (decision.message) {
    const part = waitingPart(byId, decision.message.partId, 'message')
    const planned = planMessage(mail, part, decision.message, acknowledgedRisk, context)
    files.push(planned.row)
    writeFolders.push(planned.writeFolder)
  }

  if (files.length > 0 && senderNeedsAcknowledgement(mail) && !decision.acknowledgeSender) {
    throw refusal('sender_not_acknowledged', 'This sender is not confirmed; filing needs acknowledgeSender', { mailId: mail.id })
  }
  const acknowledgedSender = files.length > 0 && Boolean(decision.acknowledgeSender)
  return {
    mailId: mail.id,
    ifMatch: decision.ifMatch,
    files: files.map((row) => ({ ...row, acknowledgedSender })),
    writeFolders,
    freshNames,
  }
}

export function requireThreadsHoldBatch(
  plans: readonly PlannedMailDecision[],
  threads: ReadonlyMap<string, Pick<ThreadDocument, 'entryCount'>>,
): void {
  const entries = new Map<string, number>()
  for (const row of plans.flatMap((plan) => plan.files)) {
    if (row.threadAction !== 'append' || !row.mailThreadId) continue
    const count = (entries.get(row.mailThreadId) ?? threads.get(row.mailThreadId)?.entryCount ?? 0) + 1
    entries.set(row.mailThreadId, count)
    if (count > MAIL_THREAD_MAX_ENTRIES) {
      throw refusal('thread_full', 'The mail thread cannot hold every message of this decision; file the rest as a new thread that continues it', {
        partId: row.partId,
        mailThreadId: row.mailThreadId,
      })
    }
  }
}

export async function requireDecisionRights(
  session: AuthorizedSession,
  projectId: string,
  plans: readonly PlannedMailDecision[],
): Promise<void> {
  const folders = plans.flatMap((plan) => plan.writeFolders)
  if (folders.length > 0) await requireFolderWrite(session, projectId, folders)
  const named = new Set<string>()
  for (const fresh of plans.flatMap((plan) => plan.freshNames)) {
    if (named.has(fresh.storedName)) {
      throw refusal('name_taken', 'Two parts of this decision would be filed under one name; rename one of them', {
        partId: fresh.partId,
      })
    }
    named.add(fresh.storedName)
  }
  for (const plan of plans) {
    for (const fresh of plan.freshNames) {
      const taken = await findDocumentIdByStoredName(projectId, fresh.storedName)
      if (!taken) continue
      throw refusal(
        'name_taken',
        'A document of this name is already in the project; file the part as its next Fassung (revisionOf) or rename it',
        { partId: fresh.partId },
      )
    }
  }
}
