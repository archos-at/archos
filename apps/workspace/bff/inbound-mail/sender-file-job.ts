import 'server-only'
/**
 * The sender's own filing (`inbound_mail_sender_file`, ADR-0137, amendment of
 * 2026-11-03, rule 1): a mail whose From is a member who may write in the
 * project, signed by their domain (`sender_class = 'verified_writer'`), is
 * filed AS THAT MEMBER, without a click. The receive job queued it by name;
 * nothing it read then is trusted now. Modelled on the follow job, the earlier
 * filing without a click (`./follow-job.ts`). Per run:
 *
 * 1. **The mail.** Still waiting, still a verified writer's (the class is
 *    frozen at the hold, migration 0194), and direct filing still switched
 *    on (`./direct-filing.ts`): a job queued before the switch went off
 *    files nothing, and the mail waits for any of the project's writers.
 * 2. **The suggestion.** While the agent's suggestion for the mail is still
 *    queued or running, the run waits for it (`notBefore`), at most
 *    {@link SENDER_FILE_MAX_WAITS} times: the attachments go where the review
 *    would put them, and that is the suggestion's folder. Without one they
 *    go where the text's new Verlauf would (`./sender-filing.ts`).
 * 3. **The sender, resolved now, strictly** (a directory that does not answer
 *    retries; only WorkOS's "not a member" is "left"), and their rights asked
 *    again: the office's `inbound-mail` entitlement, `project:documents:write`
 *    in an open project (`requireMailReviewer`).
 * 4. **What to file** (`./sender-filing.ts`): the member's own view of the
 *    mail, filed as offered, every check of a person's decision applied
 *    (`planMailDecision`, `requireDecisionRights`: type, name check, name
 *    taken, folder write); a part the review refuses is left waiting and the
 *    rest goes.
 * 5. **The decision**, `via = 'sender'` in the sender's name, written with the
 *    claims and the filing job in one transaction; the other parts are left
 *    waiting, not dismissed. The database refuses the row unless the mail is
 *    a verified writer's, its raw message clean and the part unflagged.
 * 6. **The filing**, by the filing job (`inbound_mail_file`) in the sender's
 *    session: every upload check asked again as them. It tells the sender when
 *    the whole mail went (`inbound_mail.decided`, `direct`).
 *
 * Whatever waits afterwards, the whole mail when a step refused, is announced
 * as any held mail is (`inbound_mail.waiting`, to the sender per D9), so a
 * verified writer's mail is never left untold. Every run that ends (filed, left
 * waiting with its reason, or failed) is one `inbound_mail_sender_filed`
 * PostHog event and one info line, naming the mail and an outcome code, never
 * a sender, subject or address: the share of verified writers' mail that is
 * filed, and why the rest waits, is the number that says whether direct
 * filing works.
 */

import { captureServer, type ServerEventProperties } from '@/lib/analytics/posthog-server'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { resolvePinnedRequesterSessionStrict } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { requireFolderWrite } from '@/lib/authz/folder-access'
import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { listProjectsFolders } from '@/lib/filing/repository'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { requesterOf, type InboundMailSenderFilePayload, type JobAttempt, type JobSliceResult } from '@/lib/jobs-queue/types'
import { isProjectClosedError } from '@/lib/projects/project-status'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { requireMailReviewer } from './access'
import { directFilingEnabled } from './direct-filing'
import { announceWaiting } from './announce'
import { auditDecisions } from './audit'
import { mailIfMatch, planMailDecision, requireDecisionRights, type DecisionContext } from './decision'
import { mailViews } from './mail-views'
import { findMailForReceive, findMailParts, MailChangedError, PartNotWaitingError, writeMailDecisions, type DecisionActor } from './repository'
import { CORRESPONDENCE_FOLDER } from './review-defaults'
import { senderDecision, withoutPart, type FolderChoice } from './sender-filing'
import { decisionContext, FILING_CLAIM_MS, filingJobId } from './service'

/** How long one wait for the agent's suggestion lasts. */
export const SENDER_FILE_WAIT_MS = 30_000
/** How often the run waits for the suggestion before it files without it (five minutes in all). */
export const SENDER_FILE_MAX_WAITS = 10

/** Why a verified writer's mail, or some of it, waits for its sender after all. */
export const SENDER_FILE_WAIT_REASONS = [
  /** A person decided first, or the mail is gone. */
  'not_waiting',
  /** Not a verified writer's mail (the receive job queues this job for no other). */
  'not_verified_writer',
  /** Direct filing is switched off (`INBOUND_MAIL_DIRECT_FILING=false`, `./direct-filing.ts`). */
  'direct_filing_off',
  /** The sender is no longer a member of the office. */
  'sender_left',
  /** The office's `inbound-mail` entitlement is off for the sender. */
  'disabled',
  /** The sender may no longer write in the project, or it is closed. */
  'no_access',
  /** Nothing of it can go without the sender: flagged, unnamed, or with no confident folder. */
  'nothing_to_file',
  /** The review refused it (its type, a name check, every folder); the refusal's code is logged. */
  'refused',
  /** The mail changed under the decision (someone decided first): the sender's filing yields. */
  'changed',
] as const
export type SenderFileWaitReason = (typeof SENDER_FILE_WAIT_REASONS)[number]

/** What one run did. */
export type SenderFileOutcome =
  | { kind: 'filed'; parts: number; left: number }
  /** The agent's suggestion is still being made: the run comes back. */
  | { kind: 'later' }
  | { kind: 'waits'; reason: SenderFileWaitReason }

const waits = (reason: SenderFileWaitReason): SenderFileOutcome => ({ kind: 'waits', reason })

/** The slice (`systemSliceHandler`): one mail, then „not yet“ while its suggestion is being made. */
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
    // The last attempt leaves the mail waiting, and someone must hear that it does.
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

/** The job's INFO line: how a direct filing ended is the operator's trail, as a delivery's is (`./receive.ts`). */
function logInfo(line: string): void {
  // oxlint-disable-next-line no-console -- the per-run INFO line is the operator's trail
  console.info(line)
}

/** One run's end, as `inbound_mail_sender_filed`: codes and counts only, personless (the job acts, not a person). */
function captureOutcome(organizationId: string, properties: ServerEventProperties): void {
  captureServer({ event: 'inbound_mail_sender_filed', distinctId: null, organizationId, properties })
}

/** Steps 1–6 of the module header. Exported for its spec. */
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

/** The sender may still decide the project's mail: entitled, a writer, the project open. */
async function mayFile(session: AuthorizedSession, projectId: string): Promise<boolean> {
  try {
    return !(await requireMailReviewer(session, projectId)).closed
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError || isProjectClosedError(error)) return false
    throw error
  }
}

/** Whether the agent's suggestion for the mail is still queued or running. */
async function suggestionPending(organizationId: string, mailId: string): Promise<boolean> {
  return (await findOpenJobId({ kind: 'inbound_mail_suggest', organizationId, matching: { mailId } })) !== null
}

/** The first correspondence folder the sender may write in, for a new Verlauf the agent placed nowhere. */
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

/**
 * Steps 4–6: plan the decision as a person's is planned, dropping each part
 * the review refuses by name; then write it, `via = 'sender'`, with the filing
 * job, leaving every other part waiting.
 */
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
      const partId = refusedPart(error)
      if (!partId) return refusedWhole(mail, error)
      logInfo(`[inbound-mail] sender filing of mail ${mail.id}: a part waits (${refusalCode(error)})`)
      decision = withoutPart(decision, partId)
    }
  }
  return told(mail, 'refused')
}

/** The part a refusal names, when it names one: that part waits and the rest is filed. */
function refusedPart(error: unknown): string | null {
  if (!(error instanceof ConflictError)) return null
  const details = (error as { details?: { partId?: unknown } }).details
  return typeof details?.partId === 'string' ? details.partId : null
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

/** The mail waits after all, whole or in part: announced as any held mail is. */
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
