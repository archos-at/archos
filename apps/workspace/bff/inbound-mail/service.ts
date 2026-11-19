import 'server-only'
import { v5 as uuidv5 } from 'uuid'
import { actingProposalId, actingReaderIsAgent, currentActingSession } from '@/lib/agent-api/acting-session'
import { captureServer } from '@/lib/analytics/posthog-server'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { InboundMailPartRow, InboundMailRow, NewInboundMailDecisionRow } from '@/lib/db/schema/inbound-mail'
import { acceptedTypesForOrganization } from '@/lib/documents/accepted-types'
import { contentDisposition } from '@/lib/documents/content-disposition'
import { decodeDocumentListCursor, encodeDocumentListCursor } from '@/lib/documents/list-cursor'
import { requesterOf } from '@/lib/jobs-queue/types'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { maskText } from '@/lib/upload-screening/content-screen'
import { screenUploadName } from '@/lib/upload-screening/name-screen'
import { gatePolicy } from '@/lib/upload-screening/service'
import { requireMailReviewer } from './access'
import { announceDecided, announceWaiting, settleFilingFailed, settleHeld, settleProjectNotices } from './announce'
import { auditDecisions } from './audit'
import { partStatesOf } from './notice-repository'
import { candidatesFor } from './candidates'
import { mailIfMatch, planMailDecision, refusal, requireDecisionRights, requireThreadsHoldBatch, type DecisionContext } from './decision'
import { forwardedOrigin } from './forwarded'
import { INBOUND_MAIL_RESTORE_DAYS } from './inbound-mail-vocabulary'
import type { DismissInboundMailsBody, FileInboundMailsBody, InboundMailDecisionResultView, InboundMailListQuery, InboundMailListView, InboundMailTextView, InboundMailView } from './inbound-mail-wire'
import { scanForStorage } from './malware-scan'
import { mailReadSchema } from './read-client'
import { dismissMails, findCandidateDocuments, findLiveFolders, findMailParts, findProjectMail, findThreadDocuments, hasOpenParts, listProjectMails, MailChangedError, PartNotWaitingError, restoreMailParts, writeMailDecisions, type DecisionActor, type DecisionsWritten } from './repository'
import { onlySenderReleases } from './sender-class'
import { senderFactsOf, senderRiskLevel } from './sender-risk'
import { readStagedObject } from './staging'
import { scoreMailDecision } from './suggest-scores'
import { threadGroupsOf } from './thread-groups'
import { groupParts, loadMailViews, mailViews, masked, maskRulesFor, summaryView } from './mail-views'

export const FILING_CLAIM_MS = 5 * 60 * 1000

const DAY_MS = 86_400_000

export function filingJobId(firstDecisionId: string): string {
  return uuidv5(`grid:inbound-mail:file:${firstDecisionId}`, uuidv5.URL)
}

export function decisionActor(session: AuthorizedSession): DecisionActor {
  const proposalId = actingProposalId()
  if (proposalId) return { decidedBy: session.userId, via: 'agent_proposal', proposalId }
  if (currentActingSession() && actingReaderIsAgent()) return { decidedBy: session.userId, via: 'agent', proposalId: null }
  return { decidedBy: session.userId, via: 'app', proposalId: null }
}

export async function listInboundMails(
  session: AuthorizedSession,
  projectId: string,
  query: InboundMailListQuery,
): Promise<InboundMailListView> {
  const { closed } = await requireMailReviewer(session, projectId)
  const decoded = query.cursor ? decodeDocumentListCursor(query.cursor) : null
  if (query.cursor && !decoded) throw new BadRequestError('Invalid cursor')
  const after = decoded ? { receivedAt: decoded.createdAt, id: decoded.id } : null
  const rows = await listProjectMails(projectId, { status: query.status, outcome: query.outcome, limit: query.limit }, after)
  const page = rows.slice(0, query.limit)
  const loaded = await loadMailViews(session, projectId, page.map((row) => row.mail), closed)
  const now = Date.now()
  const items = loaded.map((entry) => ({ entry, summary: summaryView(entry.mail, entry.parts, entry.view, now, entry.vias) }))
  const last = page.at(-1)
  return {
    items: items.map((item) => item.summary),
    threadGroups:
      query.status === 'waiting' ? threadGroupsOf(items.map((item) => ({ summary: item.summary, order: item.entry.mail }))) : [],
    nextCursor:
      rows.length > query.limit && last
        ? encodeDocumentListCursor({ createdAt: last.position.receivedAt, id: last.position.id })
        : null,
  }
}

export async function requireMail(projectId: string, mailId: string): Promise<InboundMailRow> {
  const mail = await findProjectMail(projectId, mailId)
  if (!mail) throw new NotFoundError('Mail not found')
  return mail
}

export async function getInboundMail(session: AuthorizedSession, projectId: string, mailId: string): Promise<InboundMailView> {
  const { closed } = await requireMailReviewer(session, projectId)
  const [view] = await mailViews(session, projectId, [await requireMail(projectId, mailId)], closed, { senderMemory: true })
  return view as InboundMailView
}

export async function getInboundMailText(session: AuthorizedSession, projectId: string, mailId: string): Promise<InboundMailTextView> {
  await requireMailReviewer(session, projectId)
  const mail = await requireMail(projectId, mailId)
  if (mail.status !== 'waiting' || !mail.readStorageKey) {
    if (mail.status !== 'waiting') throw refusal('gone', 'The text of a handled mail is in its mail thread, if it was filed', { mailId })
    return { ownText: '', ownTextTruncated: false, quoted: [], calendar: [], masked: false, unreadable: true, forwardedFrom: null }
  }
  const read = mailReadSchema.parse(JSON.parse(new TextDecoder().decode(await readStagedObject(mail.stagingBucket, mail.readStorageKey))))
  const rules = await maskRulesFor(session.organizationId, projectId)
  const own = maskText(read.ownText, rules)
  const quoted = read.quoted.map((block) => ({ header: maskText(block.header, rules), text: maskText(block.text, rules) }))
  const anyMasked = own.findings.length > 0 || quoted.some((block) => block.header.findings.length + block.text.findings.length > 0)
  const forwardedFrom = forwardedOrigin(masked(mail.subject, rules), {
    quoted: quoted.map((block) => ({ header: block.header.text, text: block.text.text })),
  })
  return {
    ownText: own.text,
    ownTextTruncated: read.ownTextTruncated,
    quoted: quoted.map((block) => ({ header: block.header.text, text: block.text.text })),
    calendar: read.calendar.map((event) => ({
      summary: masked(event.summary, rules),
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      location: masked(event.location, rules),
      status: event.status,
    })),
    masked: anyMasked,
    unreadable: read.unreadable,
    forwardedFrom,
  }
}

const SERVED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function heldBytesHeaders(contentType: string, filename: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition('attachment', filename),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store',
  }
}

export async function readInboundMailPart(
  session: AuthorizedSession,
  projectId: string,
  mailId: string,
  partId: string,
): Promise<Response> {
  await requireMailReviewer(session, projectId)
  const mail = await requireMail(projectId, mailId)
  const part = (await findMailParts([mail.id])).find((candidate) => candidate.id === partId && candidate.kind === 'attachment')
  if (!part) throw new NotFoundError('Part not found')
  if (part.state === 'filed') throw refusal('gone', 'This attachment is filed; open its document instead', { partId })
  if (part.scanStatus !== 'clean') throw refusal('scan_not_clean', 'This attachment has no clean scan', { partId })
  if (!part.storageKey) throw refusal('gone', 'The bytes of this attachment are no longer held', { partId })
  if (actingReaderIsAgent() && (part.erasureDeferredAt || mail.erasureDeferredAt)) {
    throw refusal('legal_hold', 'This attachment is kept under a legal hold and is not sent to an agent', { partId })
  }
  const bytes = await readStagedObject(mail.stagingBucket, part.storageKey)
  recordAuditEventAfterCommit({
    action: 'inbound_mail.part_read',
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'inbound_mail',
    targetId: mail.id,
    alsoTargets: [{ type: 'project', id: projectId }],
    metadata: { projectId, partId, scan: part.scanStatus },
  })
  const type = SERVED_TYPES.has(part.contentType) ? part.contentType : 'application/octet-stream'
  return new Response(new Blob([new Uint8Array(bytes)]), { status: 200, headers: heldBytesHeaders(type, part.filename ?? `attachment-${part.position}`) })
}

export async function readInboundMailOriginal(session: AuthorizedSession, projectId: string, mailId: string): Promise<Response> {
  await requireMailReviewer(session, projectId)
  const mail = await requireMail(projectId, mailId)
  if (!mail.rawStorageKey) throw refusal('gone', 'The original of this mail is no longer held here', { mailId })
  const bytes = await readStagedObject(mail.stagingBucket, mail.rawStorageKey)
  const scan = await scanForStorage(bytes)
  recordAuditEventAfterCommit({
    action: 'inbound_mail.original_read',
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'inbound_mail',
    targetId: mail.id,
    alsoTargets: [{ type: 'project', id: projectId }],
    metadata: { projectId, scan: scan.status },
  })
  if (scan.status !== 'clean') {
    throw refusal(
      'original_not_clean',
      scan.status === 'infected' ? 'The original contains malware and cannot be downloaded' : 'The original could not be scanned; try again',
      { mailId, scan: scan.status },
    )
  }
  return new Response(new Blob([new Uint8Array(bytes)]), { status: 200, headers: heldBytesHeaders('message/rfc822', `mail-${mail.id}.eml`) })
}

async function afterDecisions(
  session: AuthorizedSession,
  projectId: string,
  written: DecisionsWritten,
  mailIds: readonly string[],
): Promise<void> {
  publishProjectChanged(session.organizationId, projectId)
  await auditDecisions(written.decisions)
  await settleProjectNotices(session.organizationId, projectId)
  await settleFilingFailed(session.organizationId, mailIds)
  await settleHeld(session.organizationId, mailIds)
}

async function tellDismissed(session: AuthorizedSession, mails: readonly InboundMailRow[], written: DecisionsWritten): Promise<void> {
  const decided = mails.filter((mail) => written.decisions.some((row) => row.mailId === mail.id))
  const states = await partStatesOf(decided.map((mail) => mail.id))
  for (const mail of decided) {
    const parts = states.get(mail.id) ?? []
    if (parts.some((state) => state === 'waiting' || state === 'filing')) continue
    await announceDecided({
      organizationId: session.organizationId,
      projectId: mail.projectId,
      mailId: mail.id,
      senderTrust: mail.senderTrust,
      senderUserId: mail.senderUserId,
      senderFlags: mail.senderFlags,
      decidedBy: session.userId,
      outcome: parts.includes('filed') ? 'filed' : 'dismissed',
    })
  }
}

export async function decisionContext(
  session: AuthorizedSession,
  projectId: string,
  body: FileInboundMailsBody,
  mails: readonly InboundMailRow[],
  parts: readonly InboundMailPartRow[],
): Promise<DecisionContext> {
  const folderIds = body.mails.flatMap((mail) => [
    ...mail.parts.map((part) => part.folderId),
    mail.message?.thread.action === 'create' ? mail.message.thread.folderId : null,
  ])
  const threadIds = [
    ...body.mails.flatMap((mail) => (mail.message?.thread.action === 'append' ? [mail.message.thread.mailThreadId] : [])),
    ...mails.flatMap((mail) => mail.threadMatch.slice(0, 1).map((match) => match.threadId)),
  ]
  const revisionIds = body.mails.flatMap((mail) => mail.parts.flatMap((part) => (part.revisionOf ? [part.revisionOf] : [])))
  const [acceptedTypes, policy, candidates, folders, threads, documents] = await Promise.all([
    acceptedTypesForOrganization(session.organizationId),
    gatePolicy(session.organizationId, projectId),
    candidatesFor(session, projectId, mails, parts),
    findLiveFolders(projectId, folderIds.filter((id): id is string => id !== null)),
    findThreadDocuments(projectId, threadIds),
    findCandidateDocuments(projectId, revisionIds),
  ])
  return {
    actor: decisionActor(session),
    bulk: body.mails.length > 1,
    acceptedTypes,
    nameStops: (filename, folderPath) => [
      ...new Set(screenUploadName(policy, { filename, folderPath }).matches.map((match) => match.term)),
    ],
    candidates,
    folders,
    threads: new Map(threads.map((thread) => [thread.threadId, thread])),
    documents: new Map(documents.map((document) => [document.documentId, document])),
  }
}

export function hoursWaitingBucket(receivedAt: Date | string, now: number): string {
  const hours = (now - new Date(receivedAt).getTime()) / 3_600_000
  if (hours < 1) return 'lt_1h'
  if (hours < 24) return 'lt_1d'
  if (hours < 24 * 7) return 'lt_7d'
  return 'gte_7d'
}

/** The text decisions whose filer chose „Nicht automatisch“, for the filing job that would start the follow. */
export function unfollowedTexts(
  body: FileInboundMailsBody,
  files: ReadonlyArray<Pick<NewInboundMailDecisionRow, 'id' | 'partId'>>,
): { noFollow?: string[] } {
  const texts = new Set(body.mails.flatMap((mail) => (mail.message?.follow === false ? [mail.message.partId] : [])))
  const ids = files.flatMap((row) => (row.id && texts.has(row.partId) ? [row.id] : []))
  return ids.length > 0 ? { noFollow: ids } : {}
}

export async function fileInboundMails(
  session: AuthorizedSession,
  projectId: string,
  body: FileInboundMailsBody,
): Promise<InboundMailDecisionResultView> {
  const { closed } = await requireMailReviewer(session, projectId)
  const mails = await Promise.all(body.mails.map((decision) => requireMail(projectId, decision.mailId)))
  const parts = await findMailParts(mails.map((mail) => mail.id))
  const context = await decisionContext(session, projectId, body, mails, parts)
  const byMail = groupParts(parts)
  const plans = body.mails.map((decision, index) =>
    planMailDecision(mails[index] as InboundMailRow, byMail.get(decision.mailId) ?? [], decision, context),
  )
  requireThreadsHoldBatch(plans, context.threads)
  await requireDecisionRights(session, projectId, plans)

  const files = plans.flatMap((plan) => plan.files)
  const first = files[0]
  const jobId = first?.id ? filingJobId(first.id) : null
  const job = jobId
    ? {
        jobId,
        organizationId: session.organizationId,
        payload: {
          projectId,
          mailIds: plans.filter((plan) => plan.files.length > 0).map((plan) => plan.mailId),
          decisionIds: files.flatMap((row) => (row.id ? [row.id] : [])),
          ...unfollowedTexts(body, files),
          requester: requesterOf(session),
        },
      }
    : null
  let written: DecisionsWritten
  try {
    written = await writeMailDecisions(
      plans.map((plan) => ({ mailId: plan.mailId, ifMatch: plan.ifMatch, files: plan.files })),
      context.actor,
      mailIfMatch,
      new Date(Date.now() + FILING_CLAIM_MS),
      job,
    )
  } catch (error) {
    if (error instanceof MailChangedError) {
      throw refusal('stale', 'The mail changed since it was read; read it again and decide again', { mailId: error.mailId })
    }
    if (error instanceof PartNotWaitingError) {
      throw refusal('part_not_waiting', 'A part is no longer waiting; read the mail again', { mailId: error.mailId })
    }
    throw error
  }

  const now = Date.now()
  const folderPathOf = (folderId: string) => context.folders.get(folderId) ?? null
  for (const plan of plans) {
    const mail = mails.find((candidate) => candidate.id === plan.mailId)
    const message = plan.files.find((row) => row.threadAction)
    const suggestionFollowed = mail
      ? scoreMailDecision({
          organizationId: session.organizationId,
          decidedBy: session.userId,
          mail,
          parts: byMail.get(plan.mailId) ?? [],
          decision: body.mails.find((decision) => decision.mailId === plan.mailId) ?? null,
          via: context.actor.via,
          folderPathOf,
          threadOf: (threadId) => context.threads.get(threadId) ?? null,
        })
      : 'no_suggestion'
    captureServer({
      event: 'inbound_mail_decided',
      distinctId: session.userId,
      organizationId: session.organizationId,
      properties: {
        files: plan.files.length,
        dismissed: written.decisions.filter((row) => row.mailId === plan.mailId && row.action === 'dismiss').length,
        suggestion_followed: suggestionFollowed,
        thread_action: message?.threadAction ?? null,
        hours_waiting_bucket: mail ? hoursWaitingBucket(mail.receivedAt, now) : null,
        risk_level: mail ? senderRiskLevel(senderFactsOf(mail)) : null,
        via: context.actor.via,
      },
    })
  }
  await afterDecisions(session, projectId, written, body.mails.map((mail) => mail.mailId))
  const nothingFiled = new Set(plans.filter((plan) => plan.files.length === 0).map((plan) => plan.mailId))
  await tellDismissed(session, mails.filter((mail) => nothingFiled.has(mail.id)), written)
  const fresh = await Promise.all(body.mails.map((decision) => requireMail(projectId, decision.mailId)))
  return { mails: await mailViews(session, projectId, fresh, closed), filingJobId: jobId }
}

export interface MailsDismissed {
  mails: InboundMailRow[]
  written: DecisionsWritten
  closed: boolean
}

export async function dismissAsDecided(session: AuthorizedSession, projectId: string, mailIds: readonly string[]): Promise<MailsDismissed> {
  const { closed } = await requireMailReviewer(session, projectId)
  const mails = await Promise.all(mailIds.map((mailId) => requireMail(projectId, mailId)))
  const before = groupParts(await findMailParts(mailIds))
  const actor = decisionActor(session)
  let written: DecisionsWritten
  try {
    written = await dismissMails(projectId, mailIds, actor)
  } catch (error) {
    if (error instanceof PartNotWaitingError) {
      throw refusal('part_not_waiting', 'A part is no longer waiting; read the mail again', { mailId: error.mailId })
    }
    throw error
  }
  for (const mail of mails) {
    const dismissed = written.decisions.filter((row) => row.mailId === mail.id).length
    if (dismissed === 0) continue
    const suggestionFollowed = scoreMailDecision({
      organizationId: session.organizationId,
      decidedBy: session.userId,
      mail,
      parts: before.get(mail.id) ?? [],
      decision: null,
      via: actor.via,
      folderPathOf: () => null,
      threadOf: () => null,
    })
    captureServer({
      event: 'inbound_mail_decided',
      distinctId: session.userId,
      organizationId: session.organizationId,
      properties: {
        files: 0,
        dismissed,
        suggestion_followed: suggestionFollowed,
        thread_action: null,
        risk_level: senderRiskLevel(senderFactsOf(mail)),
        via: actor.via,
      },
    })
  }
  await afterDecisions(session, projectId, written, mailIds)
  return { mails, written, closed }
}

export async function dismissInboundMails(
  session: AuthorizedSession,
  projectId: string,
  body: DismissInboundMailsBody,
): Promise<{ mails: InboundMailView[] }> {
  const { mails, written, closed } = await dismissAsDecided(session, projectId, body.mailIds)
  await tellDismissed(session, mails, written)
  const fresh = await Promise.all(body.mailIds.map((mailId) => requireMail(projectId, mailId)))
  return { mails: await mailViews(session, projectId, fresh, closed) }
}

export async function restoreInboundMail(session: AuthorizedSession, projectId: string, mailId: string): Promise<InboundMailView> {
  const { closed } = await requireMailReviewer(session, projectId)
  const mail = await requireMail(projectId, mailId)
  if (onlySenderReleases(mail, session.userId)) {
    throw refusal('sender_only', 'This mail claims another member as its sender; only that member can restore it', { mailId })
  }
  const now = Date.now()
  const written = await restoreMailParts(
    projectId,
    mailId,
    decisionActor(session),
    new Date(now - INBOUND_MAIL_RESTORE_DAYS * DAY_MS),
    new Date(now + INBOUND_MAIL_RESTORE_DAYS * DAY_MS),
  )
  if (written.decisions.length === 0 && !(await hasOpenParts(mailId))) {
    throw refusal('not_restorable', 'Nothing of this mail can be restored any more', { mailId })
  }
  const restored = await requireMail(projectId, mailId)
  if (written.decisions.length > 0) {
    publishProjectChanged(session.organizationId, projectId)
    await auditDecisions(written.decisions)
    await settleProjectNotices(session.organizationId, projectId)
    if (restored.senderTrust) {
      await announceWaiting({
        organizationId: session.organizationId,
        projectId,
        mailId,
        senderTrust: restored.senderTrust,
        senderUserId: restored.senderUserId,
        senderFlags: restored.senderFlags,
        automatic: restored.automatic,
      })
    }
  }
  const [view] = await mailViews(session, projectId, [restored], closed)
  return view as InboundMailView
}
