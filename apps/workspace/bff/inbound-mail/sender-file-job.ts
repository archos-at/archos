import 'server-only'

import { captureServer, type ServerEventProperties } from '@/lib/analytics/posthog-server'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { resolvePinnedRequesterSessionStrict } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { requireFolderWrite } from '@/lib/authz/folder-access'
import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { listProjectsFolders } from '@/lib/filing/repository'
import { requesterOf, type InboundMailSenderFilePayload, type JobAttempt, type JobSliceResult } from '@/lib/jobs-queue/types'
import { isProjectClosedError } from '@/lib/projects/project-status'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { requireMailReviewer } from './access'
import { directFilingEnabled } from './direct-filing'
import { announceWaiting } from './announce'
import { auditDecisions } from './audit'
import { mailIfMatch, planMailDecision, refusedPartOf, requireDecisionRights, type DecisionContext } from './decision'
import { mailViews } from './mail-views'
import { findMailForReceive, findMailParts, MailChangedError, PartNotWaitingError, writeMailDecisions, type DecisionActor } from './repository'
import { CORRESPONDENCE_FOLDER } from './review-defaults'
import { senderDecision, withoutPart, type FolderChoice } from './sender-filing'
import { decisionContext, FILING_CLAIM_MS, filingJobId } from './service'
import { SUGGESTION_MAX_WAITS, SUGGESTION_WAIT_MS, suggestionPending } from './suggestion-wait'

export const SENDER_FILE_WAIT_MS = SUGGESTION_WAIT_MS
export const SENDER_FILE_MAX_WAITS = SUGGESTION_MAX_WAITS

export const SENDER_FILE_WAIT_REASONS = [
  'not_waiting',
  'not_verified_writer',
  'direct_filing_off',
  'sender_left',
  'disabled',
  'no_access',
  'nothing_to_file',
  'refused',
  'changed',
] as const
export type SenderFileWaitReason = (typeof SENDER_FILE_WAIT_REASONS)[number]

export type SenderFileOutcome =
  | { kind: 'filed'; parts: number; left: number }
  | { kind: 'later' }
  | { kind: 'waits'; reason: SenderFileWaitReason }

const waits = (reason: SenderFileWaitReason): SenderFileOutcome => ({ kind: 'waits', reason })

export async function runInboundMailSenderFile(
  organizationId: string,
  payload: InboundMailSenderFilePayload,
  attempt: JobAttempt,
): Promise<JobSliceResult<InboundMailSenderFilePayload>> {
  let outcome: SenderFileOutcome
  try {
    outcome = await fileAsSender(organizationId, payload)
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown'
    console.warn(`[inbound-mail] sender filing of mail ${payload.mailId}: failed (${name})${attempt.last ? ', last attempt' : ''}`)
    captureOutcome(organizationId, { outcome: 'failed', last_attempt: attempt.last })
    if (attempt.last) await tellWaiting(await findMailForReceive(payload.mailId))
    throw error
  }
  if (outcome.kind !== 'later') {
    logInfo(`[inbound-mail] sender filing of mail ${payload.mailId}: ${outcome.kind}${'reason' in outcome ? `:${outcome.reason}` : ''}`)
    captureOutcome(
      organizationId,
      outcome.kind === 'filed'
        ? { outcome: 'filed', files: outcome.parts, left: outcome.left, waits_for_suggestion: payload.waits }
        : { outcome: 'waits', reason: outcome.reason, waits_for_suggestion: payload.waits },
    )
  }
  if (outcome.kind === 'later') {
    return { done: false, payload: { ...payload, waits: payload.waits + 1 }, notBefore: new Date(Date.now() + SENDER_FILE_WAIT_MS) }
  }
  return { done: true, payload }
}

function logInfo(line: string): void {
  // oxlint-disable-next-line no-console -- the per-run INFO line is the operator's trail
  console.info(line)
}

function captureOutcome(organizationId: string, properties: ServerEventProperties): void {
  captureServer({ event: 'inbound_mail_sender_filed', distinctId: null, organizationId, properties })
}

export async function fileAsSender(organizationId: string, payload: InboundMailSenderFilePayload): Promise<SenderFileOutcome> {
  const mail = await findMailForReceive(payload.mailId)
  if (!mail || mail.organizationId !== organizationId || mail.projectId !== payload.projectId || mail.status !== 'waiting') {
    return waits('not_waiting')
  }
  if (mail.senderClass !== 'verified_writer' || !mail.senderUserId) return told(mail, 'not_verified_writer')
  if (!directFilingEnabled()) return told(mail, 'direct_filing_off')
  if (payload.waits < SENDER_FILE_MAX_WAITS && (await suggestionPending(organizationId, mail.id))) return { kind: 'later' }

  const session = await resolvePinnedRequesterSessionStrict({ userId: mail.senderUserId, email: null, organizationId })
  if (!session) return told(mail, 'sender_left')
  if (!isInboundMailEnabled(session)) return told(mail, 'disabled')
  if (!(await mayFile(session, mail.projectId))) return told(mail, 'no_access')

  const [view] = await mailViews(session, mail.projectId, [mail], false)
  const rows = await findMailParts([mail.id])
  const decision = view ? senderDecision(view, rows, await correspondenceFolder(session, mail.projectId)) : null
  if (!decision) return told(mail, 'nothing_to_file')
  return fileDecision(session, mail, rows, decision)
}

async function mayFile(session: AuthorizedSession, projectId: string): Promise<boolean> {
  try {
    return !(await requireMailReviewer(session, projectId)).closed
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError || isProjectClosedError(error)) return false
    throw error
  }
}

async function correspondenceFolder(session: AuthorizedSession, projectId: string): Promise<FolderChoice | null> {
  const folders = (await listProjectsFolders(session.organizationId, [projectId])).filter((folder) => CORRESPONDENCE_FOLDER.test(folder.path))
  for (const folder of folders) {
    try {
      await requireFolderWrite(session, projectId, [folder.id])
      return { folderId: folder.id }
    } catch (error) {
      if (!(error instanceof NotFoundError) && !(error instanceof ForbiddenError)) throw error
    }
  }
  return null
}

async function fileDecision(
  session: AuthorizedSession,
  mail: InboundMailRow,
  rows: readonly InboundMailPartRow[],
  initial: NonNullable<ReturnType<typeof senderDecision>>,
): Promise<SenderFileOutcome> {
  const actor: DecisionActor = { decidedBy: session.userId, via: 'sender', proposalId: null }
  const body = { mails: [initial] }
  const context: DecisionContext = { ...(await decisionContext(session, mail.projectId, body, [mail], rows)), actor }
  let decision: typeof initial | null = initial
  while (decision) {
    try {
      const plan = planMailDecision(mail, rows, decision, context)
      await requireDecisionRights(session, mail.projectId, [plan])
      return await writeAsSender(session, mail, rows, plan)
    } catch (error) {
      const partId = refusedPartOf(error)
      if (!partId) return refusedWhole(mail, error)
      logInfo(`[inbound-mail] sender filing of mail ${mail.id}: a part waits (${refusalCode(error)})`)
      decision = withoutPart(decision, partId)
    }
  }
  return told(mail, 'refused')
}

function refusalCode(error: unknown): string {
  const details = (error as { details?: { reason?: unknown } }).details
  return typeof details?.reason === 'string' ? details.reason : error instanceof Error ? error.name : 'unknown'
}

async function refusedWhole(mail: InboundMailRow, error: unknown): Promise<SenderFileOutcome> {
  if (error instanceof MailChangedError || error instanceof PartNotWaitingError) return waits('changed')
  if (error instanceof ConflictError && refusalCode(error) === 'stale') return waits('changed')
  if (error instanceof ConflictError || error instanceof NotFoundError || error instanceof ForbiddenError || isProjectClosedError(error)) {
    logInfo(`[inbound-mail] sender filing of mail ${mail.id}: refused (${refusalCode(error)})`)
    return told(mail, 'refused')
  }
  throw error
}

async function writeAsSender(
  session: AuthorizedSession,
  mail: InboundMailRow,
  rows: readonly InboundMailPartRow[],
  plan: ReturnType<typeof planMailDecision>,
): Promise<SenderFileOutcome> {
  const [first] = plan.files
  if (!first?.id) return told(mail, 'nothing_to_file')
  const jobId = filingJobId(first.id)
  const decisionIds = plan.files.map((row) => row.id).filter((id): id is string => !!id)
  const written = await writeMailDecisions(
    [{ mailId: mail.id, ifMatch: plan.ifMatch, files: plan.files, keepOthers: true }],
    { decidedBy: session.userId, via: 'sender', proposalId: null },
    mailIfMatch,
    new Date(Date.now() + FILING_CLAIM_MS),
    {
      jobId,
      organizationId: session.organizationId,
      payload: { projectId: mail.projectId, mailIds: [mail.id], decisionIds, requester: requesterOf(session) },
    },
  )
  await auditDecisions(written.decisions)
  publishProjectChanged(session.organizationId, mail.projectId)
  const left = rows.filter((row) => row.state === 'waiting').length - plan.files.length
  captureServer({
    event: 'inbound_mail_decided',
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: { files: plan.files.length, dismissed: 0, left, via: 'sender' },
  })
  if (left > 0) await tellWaiting(mail)
  return { kind: 'filed', parts: plan.files.length, left }
}

async function told(mail: InboundMailRow, reason: SenderFileWaitReason): Promise<SenderFileOutcome> {
  await tellWaiting(mail)
  return waits(reason)
}

async function tellWaiting(mail: InboundMailRow | null): Promise<void> {
  if (!mail?.senderTrust || mail.status !== 'waiting') return
  await announceWaiting({
    organizationId: mail.organizationId,
    projectId: mail.projectId,
    mailId: mail.id,
    senderTrust: mail.senderTrust,
    senderUserId: mail.senderUserId,
    senderFlags: mail.senderFlags,
    automatic: mail.automatic,
  })
}
