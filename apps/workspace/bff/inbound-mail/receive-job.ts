/**
 * The receive job (`inbound_mail_receive`, ADR-0137, DECISION §6 "Read and
 * stage"): read one staged mail, scan it, label it and hold it for a person.
 *
 * Runs AS THE SYSTEM (`SYSTEM_ACTORS.inboundMail`), one step, bulk. It decides
 * nothing a person would and it cannot file: it imports no filing code
 * (`review-first.spec.ts`), and the database refuses a filed part without a
 * person's decision (migrations 0193, 0194). What it leaves is a `waiting` mail
 * with its parts and its sender's class (`./sender-class.ts`), and at most two
 * jobs queued for later: The agent's suggestion (metadata only, D21) and
 * either the sender's own filing (`inbound_mail_sender_file`, for a verified
 * writer's mail: it runs as that member and files what they sent as them) or,
 * when a person's standing decision to follow the thread could cover the
 * reply, the follow job, which runs as that person and re-checks everything
 * before it appends a word. Each is queued by its kind's name only.
 *
 * Each run asks again, in this order:
 *  1. Load the row and read `raw.eml`. A mail past `received` was done by an
 *     earlier run (a `waiting` one not yet announced is announced now).
 *  2. Scan the whole raw message (`ScanMail yes`) and store the verdict, before
 *     anything else: a mail is never `waiting` unscanned (CHECK).
 *  3. Drop auto-replies, delivery reports and loops, erasing the raw message by
 *     its key (a legal hold defers that). List and bulk mail is kept, marked
 *     `automatic`. A forward records its original's author (`./receive-original`);
 *     its original's Message-ID is the sender's word and never drops a delivery.
 *  4. Authenticate the sender (DKIM and DMARC, `sender-auth.ts`); a DNS fault is waited out briefly.
 *  5. Read the MIME tree (`mime.ts`) against the office's accepted types, then
 *     find the member by exact address, or an outsider's display name that
 *     claims a member's (`claims_member_name`), and whether that member may
 *     write in the project (`project:documents:write`). A directory or write
 *     check WorkOS does not answer is a fault, never a "no".
 *  6. The Namensprüfung on each attachment's name and the base subject.
 *  7. Scan each attachment, at most {@link ATTACHMENT_SCANS_IN_FLIGHT} at once.
 *     A run after a fault reuses the sender's authentication and each scan an
 *     earlier run reached, unless transient or failed (`./receive-progress.ts`).
 *  8. The Python reader (`/v1/mail/read`): own text, quotes, invitations; the
 *     content check on the own text, after the signature was removed.
 *  9. Redact every other project's address (B8) in the subject, the
 *     participants, the text, every quote and its header, the invitations.
 * 10. Match the project's threads and look up the Message-ID
 *     (`message_id_reused`, `already_filed`); ids and strengths only.
 * 11. Classify the sender (`senderClassOf`), stage the attachments and
 *     `read.json`, insert the parts, `waiting`, with the class and its window
 *     (an outsider's mail waits 14 days, every other 30).
 * 12. A verified writer's mail queues its sender's filing; any other mail,
 *     when conditions 1–6 of D31 hold (`followEligibility`, pure), queues
 *     `inbound_mail_follow`.
 * 13. Announce: a verified writer's mail is the sender job's to tell about;
 *     every other mail `inbound_mail.waiting`, and the member it names hears
 *     why it waits (`inbound_mail.held`, `inbound_mail.held_for_writers`).
 *     Then the live hint, the audit event, PostHog, and the agent's
 *     suggestion unless `suggestionSkipReason` says otherwise (an unconfirmed
 *     sender, an impersonation, automatic mail).
 *
 * A dependency that does not answer (WorkOS, the reader, the object store,
 * the database) spends no attempt: the job waits it out for about six hours
 * and only then holds the mail with what it could not learn, flagged, never
 * guessed (`./receive-faults.ts`). DNS for DKIM, which the sender's own
 * nameserver can fail at will, gets twelve minutes and then its transient
 * reason stands. Any other failure retries
 * through the queue, and on the last attempt the mail is held anyway, flagged
 * `unreadable`, with a text part whose original can be downloaded once its scan
 * is clean: mail is never lost to a parser bug. Its sender keeps the class the
 * evidence gave before the failure, or `sender_unchecked` when there was none.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import { SYSTEM_ACTORS } from '@/lib/audit/service'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { isCoveredByActiveHold } from '@/lib/compliance/repository'
import type { InboundMailRow, NewInboundMailPartRow } from '@/lib/db/schema/inbound-mail'
import { acceptedTypesForOrganization } from '@/lib/documents/accepted-types'
import { documentNameKey } from '@/lib/documents/name-match'
import { insertJobIfAbsent } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY, requesterOf, type InboundMailReceivePayload, type JobAttempt, type JobSliceResult } from '@/lib/jobs-queue/types'
import { baseSubject, clampSentAt, matchThread } from '@/lib/mail-thread/mail-threading'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { inboundMailDomain, redactProjectAddresses } from './address'
import { classifyAutomaticMail } from './automatic-mail'
import { judgeFollow } from './follow-candidate'
import { NULL_SENDER } from './contract'
import {
  inboundMailStagingKey,
  type InboundMailContentFinding,
  type InboundMailIgnoredCounts,
  type InboundMailNotStaged,
  type PartRiskFlag,
  type SenderFlag,
} from './inbound-mail-vocabulary'
import { scanForStorage } from './malware-scan'
import { rawHeaderFields, readMime, type MailAttachment, type NotStagedPart } from './mime'
import { redactRead, unreadableRead, type MailRead } from './read-client'
import { mailParticipants, participantDomainsOf, recipientCountOf } from './receive-participants'
import {
  dependencyOf,
  DependencyFaultError,
  DKIM_DNS_FAULT_BUDGET,
  fromObjectStore,
  nextFaultTry,
  readHeldText,
  RECEIVE_FAULT_BUDGET,
  senderIdentityFor,
} from './receive-faults'
import { recordOriginal } from './receive-original'
import { progressOf, rememberAuthentication, reusableAuthentication, scanAttachments, type ReceiveProgress } from './receive-progress'
import {
  dropMail,
  findAddressToken,
  findFiledMessages,
  findMailForReceive,
  findPartSummaries,
  findScreenedDuplicates,
  findScreenedNamesakes,
  findThreadCandidates,
  holdMail,
  keepReceiveProgress,
  markNotified,
  recordRawScan,
  type HeldMailFields,
  type PartSummary,
  type StoredScan,
} from './repository'
import { mailScreeningFor, type MailScreening } from './screening'
import { authenticateSender, dateHeaderOf, isTransientReason, judgeSender, type SenderVerdict } from './sender-auth'
import { eraseStagedObjects, putStagedObject, readStagedObject } from './staging'
import { suggestionSkipReason } from './suggest'
import { announceHeldMail, classified, inboundMailJobId, queueSenderFiling } from './receive-sender'

export { inboundMailJobId } from './receive-sender'

/**
 * Attachment scans one mail runs at once. clamd runs `MaxThreads 8` and queues
 * `MaxConnectionQueueLength 30` (`deploy/compose/clamav/clamd.conf`) for every
 * `bff-jobs` replica together, each running `BFF_JOBS_CONCURRENCY` jobs. A mail
 * of 100 attachments scanned all at once overran that queue, and its scans came
 * back `failed` with no outage at all (S2 of the 2026-11 ship review).
 */
export const ATTACHMENT_SCANS_IN_FLIGHT = 4

/**
 * The job's slice (`systemSliceHandler`): one run, done, or given back while a
 * dependency does not answer (`./receive-faults.ts`). Throws to retry a bug;
 * holds the mail anyway on its last attempt.
 */
export async function runInboundMailReceive(
  organizationId: string,
  payload: InboundMailReceivePayload,
  attempt: JobAttempt,
): Promise<JobSliceResult<InboundMailReceivePayload>> {
  const degraded = (payload.faults ?? 0) >= RECEIVE_FAULT_BUDGET
  const budget: ReceiveBudget = { degraded, dkimSpent: degraded || (payload.dkimFaults ?? 0) >= DKIM_DNS_FAULT_BUDGET }
  try {
    await receive(organizationId, payload, attempt, budget)
    return { done: true, payload }
  } catch (error) {
    const dependency = dependencyOf(error)
    const next = dependency ? nextFaultTry(dependency, payload, new Date()) : null
    if (!dependency || !next) throw error
    const tries = dependency === 'dkim_dns' ? next.payload.dkimFaults : next.payload.faults
    console.warn(
      `[inbound-mail] mail ${payload.mailId}: the ${dependency} did not answer (${tries} of ${next.budget}); again at ${next.notBefore.toISOString()}`,
    )
    return { done: false, payload: next.payload, notBefore: next.notBefore }
  }
}

/**
 * What a run may no longer wait for. `degraded`: the long budget is spent, so
 * what a dependency could not answer is held as unknown. `dkimSpent`: DNS for
 * DKIM had its two waits, so a transient reason stands as the verdict.
 */
interface ReceiveBudget {
  degraded: boolean
  dkimSpent: boolean
}

/** One run (see {@link ReceiveBudget}). */
async function receive(organizationId: string, payload: InboundMailReceivePayload, attempt: JobAttempt, budget: ReceiveBudget): Promise<void> {
  const { degraded } = budget
  const mail = await findMailForReceive(payload.mailId)
  if (!mail || mail.projectId !== payload.projectId || mail.organizationId !== organizationId) return
  const domain = inboundMailDomain()
  if (!domain) throw new Error('INBOUND_MAIL_DOMAIN is not set: a received mail cannot be read')
  if (mail.status === 'waiting') {
    // An earlier run held it and died before telling anyone.
    if (!mail.notifiedAt) await afterHold(mail.id, domain, null)
    return
  }
  if (mail.status !== 'received' || !mail.rawStorageKey) return

  const rawKey = mail.rawStorageKey
  const raw = await fromObjectStore(() => readStagedObject(mail.stagingBucket, rawKey))
  if (mail.rawScanStatus === 'pending') await recordRawScan(mail.id, await scanForStorage(raw))

  const automatic = classifyAutomaticMail({ headers: rawHeaderFields(raw), envelopeFrom: mail.envelopeFrom, inboundDomain: domain })
  if (automatic.outcome === 'drop') return drop(mail, automatic.reason, attempt)
  // A forward: who wrote the original (`./receive-original`). Never a reason to drop: anyone can write its Message-ID.
  await recordOriginal(mail, raw, domain)

  // What the run learned of the sender before anything failed: a mail held unreadable keeps it.
  const evidence: SenderEvidence = { progress: progressOf(mail.receiveProgress) }
  let held: boolean
  try {
    held = await readAndHold(mail, raw, domain, automatic.automatic, budget, evidence)
  } catch (error) {
    const fault = dependencyOf(error) !== null
    // A fault is waited out: the next run reuses the verdicts this one reached (`./receive-progress`).
    if (fault && !degraded) await keepProgress(mail.id, evidence.progress)
    if (fault ? !degraded : !attempt.last) throw error
    console.error(`[inbound-mail] mail ${mail.id} could not be read (${errorName(error)}); holding it as unreadable`)
    held = await holdUnreadable(mail, raw, automatic.automatic, evidence)
  }
  if (held) await afterHold(mail.id, domain, raw)
}

// ---------------------------------------------------------------------------
// Step 3: automatic mail nobody needs to see
// ---------------------------------------------------------------------------

async function drop(mail: InboundMailRow, reason: NonNullable<InboundMailRow['droppedReason']>, attempt: JobAttempt): Promise<void> {
  const deferred = await isCoveredByActiveHold(mail.organizationId, 'project', mail.projectId)
  if (!deferred && mail.rawStorageKey) {
    const left = await eraseStagedObjects(mail.stagingBucket, [mail.rawStorageKey])
    // The key may only go with its object: retry, and on the last attempt let
    // the deferred-erasure sweep finish it.
    if (left.length > 0 && !attempt.last) throw new Error(`the raw message of mail ${mail.id} could not be erased`)
    if (left.length > 0) return void (await dropMail(mail.id, { reason, erasureDeferred: true }))
  }
  if (!(await dropMail(mail.id, { reason, erasureDeferred: deferred }))) return
  recordAuditEventAfterCommit({
    organizationId: mail.organizationId,
    actor: { userId: SYSTEM_ACTORS.inboundMail, email: null },
    action: 'inbound_mail.received',
    targetType: 'inbound_mail',
    targetId: mail.id,
    alsoTargets: [{ type: 'project', id: mail.projectId }],
    metadata: { projectId: mail.projectId, dropped: reason },
    idempotencyKey: `inbound_mail.received:${mail.id}`,
  })
  captureServer({ event: 'inbound_mail_dropped', distinctId: null, organizationId: mail.organizationId, properties: { reason } })
}

// ---------------------------------------------------------------------------
// Steps 4-11: read, label, hold
// ---------------------------------------------------------------------------

/** The sender as far as a run judged it: the verdict and the flags it carries, and what the next run may reuse. */
interface SenderEvidence {
  verdict?: SenderVerdict
  flags?: SenderFlag[]
  progress: ReceiveProgress
}

/** Best effort: progress the database does not take is asked again by the next run. */
async function keepProgress(mailId: string, progress: ReceiveProgress): Promise<void> {
  await keepReceiveProgress(mailId, progress).catch(() => undefined)
}

async function readAndHold(
  mail: InboundMailRow,
  raw: Uint8Array,
  domain: string,
  automatic: boolean,
  { degraded, dkimSpent }: ReceiveBudget,
  evidence: SenderEvidence,
): Promise<boolean> {
  const token = await findAddressToken(mail.addressId)
  if (!token) throw new Error(`the address of mail ${mail.id} is gone`)
  const authentication =
    reusableAuthentication(evidence.progress) ??
    (await authenticateSender(raw, { projectToken: token, inboundDomain: domain, envelopeFrom: mail.envelopeFrom }))
  rememberAuthentication(evidence.progress, authentication)
  if (isTransientReason(authentication.reason) && !dkimSpent) {
    throw new DependencyFaultError('dkim_dns', new Error(`sender authentication was inconclusive (${authentication.reason})`))
  }
  if (authentication.reason === 'verifier_error') console.error(`[inbound-mail] mail ${mail.id}: the verifier threw; its sender is held unverified`)
  const mime = await readMime(raw, { acceptedTypes: await acceptedTypesForOrganization(mail.organizationId) })
  const fromName = mime.kind === 'read' ? (mime.headers.from?.name ?? null) : null
  const identity = await senderIdentityFor(mail.organizationId, authentication.fromAddress, fromName, degraded)
  const sentAtHeader = mime.kind === 'read' ? mime.headers.sentAtHeader : dateHeaderOf(raw)
  const { memberUserId, claimsMemberName } = identity
  const verdict = judgeSender(authentication, { memberUserId, claimsMemberName, receivedAt: mail.receivedAt, sentAtHeader })
  evidence.verdict = verdict
  evidence.flags = [...verdict.flags, ...(identity.unchecked ? (['sender_unchecked'] as const) : [])]
  if (mime.kind === 'unreadable') return holdUnreadable(mail, raw, automatic, evidence)

  const screening = await mailScreeningFor(mail.organizationId, mail.projectId)
  const scans = await scanAttachments(mime.attachments, evidence.progress, ATTACHMENT_SCANS_IN_FLIGHT, scanForStorage)
  const text = await readHeldText(mail, degraded)
  const read = redactRead(text.read, (text) => redactProjectAddresses(text, domain, token))
  const redact = (text: string) => redactProjectAddresses(text, domain, token)
  const subject = mime.headers.subject === null ? null : redact(mime.headers.subject)
  const participants = mailParticipants(mime.headers, domain, redact)
  const base = baseSubject(subject)
  const ownTextSha256 = sha256Hex(read.ownText)

  const flags: SenderFlag[] = [...evidence.flags, ...(await messageIdFlags(mail.projectId, mime.headers.messageId, ownTextSha256))]
  const candidates = await findThreadCandidates(mail.projectId, {
    messageIds: [mime.headers.messageId, ...mime.headers.inReplyTo, ...mime.headers.references].filter((id): id is string => !!id),
    threadIndexGuid: mime.headers.threadIndexGuid,
    baseSubject: base,
    participants: participants.map((participant) => participant.address),
  })
  const threadMatch = matchThread(
    {
      messageId: mime.headers.messageId,
      inReplyTo: mime.headers.inReplyTo,
      references: mime.headers.references,
      threadIndexGuid: mime.headers.threadIndexGuid,
      baseSubject: base,
      participants: participants.map((participant) => participant.address),
      sentAt: verdict.sentAt,
    },
    candidates,
  ).slice(0, 50)

  const owner = { organizationId: mail.organizationId, projectId: mail.projectId }
  const attachmentParts = await attachmentPartsOf(mail, mime.attachments, scans, screening)
  for (const [index, attachment] of mime.attachments.entries()) {
    const key = attachmentParts[index].storageKey as string
    await fromObjectStore(() => putStagedObject(mail.stagingBucket, key, attachment.content, attachmentParts[index].contentType))
  }
  const readKey = inboundMailStagingKey(owner, mail.id, 'read.json')
  await fromObjectStore(() => putStagedObject(mail.stagingBucket, readKey, Buffer.from(JSON.stringify(read)), 'application/json'))

  const messagePart = textPartOf(mail, read, ownTextSha256, screening.contentFindings(read.ownText))
  const fields: HeldMailFields = {
    ...senderFields(verdict, flags, mail, mime.headers.from?.address ?? null),
    ...(await classified(mail, verdict, flags, automatic, degraded)),
    readStorageKey: readKey,
    // The reader did not answer for the whole budget: the sweep reads the text again (`./receive-reread.ts`).
    readerFaultAt: text.readerFault ? new Date() : null,
    messageId: mime.headers.messageId,
    inReplyTo: mime.headers.inReplyTo.slice(0, 5),
    referenceIds: mime.headers.references.slice(0, 50),
    threadIndexGuid: mime.headers.threadIndexGuid,
    baseSubject: base.slice(0, 500),
    threadMatch,
    senderName: mime.headers.from?.name ? redact(mime.headers.from.name).slice(0, 300) : null,
    subject: subject?.slice(0, 998) ?? null,
    participants: participants.slice(0, 200),
    participantDomains: participantDomainsOf(participants),
    recipientCount: recipientCountOf(mime.headers, domain),
    automatic,
    ...notStagedFields(mime.notStaged, mime.notStagedOverflow, redact),
  }
  return holdMail(mail.id, fields, [messagePart, ...attachmentParts])
}

/**
 * The Message-ID flags (D11, D33): the project already received this id
 * (`message_id_reused`, perhaps a forger took it first), or the same message is
 * in a Verlauf already (`already_filed`: the same own text, or an entry from
 * the person's own archive). Neither blocks anything; each unchecks a default.
 */
async function messageIdFlags(projectId: string, messageId: string | null, ownTextSha256: string): Promise<SenderFlag[]> {
  if (!messageId) return []
  const filed = await findFiledMessages(projectId, messageId)
  if (filed.length === 0) return []
  const same = filed.some((entry) => entry.source === 'archive' || entry.ownTextSha256 === ownTextSha256)
  return [same ? 'already_filed' : 'message_id_reused']
}

/** Steps 6, 7 and the ids of step 10, per attachment: the part rows (bytes are written by the caller). */
async function attachmentPartsOf(
  mail: InboundMailRow,
  attachments: readonly MailAttachment[],
  scans: readonly StoredScan[],
  screening: MailScreening,
): Promise<Array<NewInboundMailPartRow & { storageKey: string; contentType: string }>> {
  const owner = { organizationId: mail.organizationId, projectId: mail.projectId }
  const names = attachments.map((attachment) => (attachment.filename ? documentNameKey(attachment.filename) : null))
  const [duplicates, namesakes] = await Promise.all([
    findScreenedDuplicates(mail.projectId, attachments.map((attachment) => attachment.sha256)),
    findScreenedNamesakes(mail.projectId, names.filter((name): name is string => !!name)),
  ])
  return attachments.map((attachment, index) => {
    const scan = scans[index]
    const nameStops = attachment.filename ? screening.nameStops(attachment.filename) : []
    const duplicateOf = duplicates.get(attachment.sha256) ?? null
    const name = names[index]
    const riskFlags: PartRiskFlag[] = [
      ...attachment.riskFlags,
      ...(nameStops.length > 0 ? (['name_stop'] as const) : []),
      ...(duplicateOf ? (['duplicate_of'] as const) : []),
    ]
    return {
      organizationId: mail.organizationId,
      projectId: mail.projectId,
      mailId: mail.id,
      position: attachment.position,
      kind: 'attachment' as const,
      filename: attachment.filename?.slice(0, 500) ?? null,
      contentType: (attachment.declaredType || 'application/octet-stream').slice(0, 255),
      sizeBytes: attachment.size,
      sha256: attachment.sha256,
      storageKey: inboundMailStagingKey(owner, mail.id, { position: attachment.position }),
      scanStatus: scan.status,
      scanEngine: scan.engine,
      scanSignature: scan.signature,
      scannedAt: scan.scannedAt,
      scanAttempts: 1,
      riskFlags: [...new Set(riskFlags)],
      nameStopTerms: nameStops,
      duplicateOfDocumentId: duplicateOf,
      revisionCandidateDocumentId: duplicateOf ? null : (name ? namesakes.get(name) ?? null : null),
    }
  })
}

/** The mail's own text as the one part every mail has, at position 0. Its raw message was scanned whole. */
function textPartOf(
  mail: InboundMailRow,
  read: MailRead,
  ownTextSha256: string,
  contentFindings: readonly InboundMailContentFinding[],
): NewInboundMailPartRow {
  return {
    organizationId: mail.organizationId,
    projectId: mail.projectId,
    mailId: mail.id,
    position: 0,
    kind: 'message',
    filename: null,
    contentType: 'text/plain; charset=utf-8',
    sizeBytes: Buffer.byteLength(read.ownText),
    sha256: ownTextSha256,
    storageKey: null,
    scanStatus: 'not_applicable',
    riskFlags: read.unreadable ? ['unreadable'] : [],
    contentFindings: [...contentFindings].slice(0, 32),
  }
}

/** The sender columns from the verdict (D4). A mail with no single From shows its envelope sender, never ''. */
function senderFields(
  verdict: SenderVerdict,
  flags: readonly SenderFlag[],
  mail: InboundMailRow,
  fromAddress: string | null,
): Pick<
  HeldMailFields,
  | 'senderAddress'
  | 'senderTrust'
  | 'senderUserId'
  | 'senderReason'
  | 'signerDomain'
  | 'signedHeaders'
  | 'senderFlags'
  | 'authenticationResults'
  | 'sentAt'
  | 'sentAtHeader'
> {
  return {
    senderAddress: (fromAddress || mail.envelopeFrom || NULL_SENDER).slice(0, 320),
    senderTrust: verdict.trust,
    senderUserId: verdict.senderUserId,
    senderReason: verdict.reason,
    signerDomain: verdict.signerDomain?.slice(0, 253) ?? null,
    signedHeaders: verdict.signedHeaders.map((header) => header.toLowerCase()).filter((header) => /^[a-z0-9-]+$/.test(header)).slice(0, 64),
    senderFlags: [...new Set(flags)],
    authenticationResults: verdict.authenticationResults.slice(0, 4096),
    sentAt: verdict.sentAt,
    sentAtHeader: verdict.sentAtHeader,
  }
}

/** What was left out of the parts, by name while the mail waits (redacted), and counted by reason. */
function notStagedFields(
  notStaged: readonly NotStagedPart[],
  overflow: number,
  redact: (text: string) => string,
): Pick<HeldMailFields, 'notStaged' | 'ignored'> {
  const listed: InboundMailNotStaged[] = notStaged
    .slice(0, 100)
    .map((part) => ({ filename: part.filename ? redact(part.filename).slice(0, 500) : '', reason: part.reason }))
  const ignored: InboundMailIgnoredCounts = {}
  for (const part of notStaged) ignored[part.reason] = (ignored[part.reason] ?? 0) + 1
  if (overflow > 0) ignored.limit = (ignored.limit ?? 0) + overflow
  return { notStaged: listed, ignored }
}

/**
 * The mail held without being read (the last attempt failed, or the parser
 * refused the message): one text part flagged `unreadable`, the sender as the
 * run judged it before it failed. A sender it never judged is not called an
 * outsider: unverified, nobody's member, flagged `sender_unchecked`, so it
 * waits the full 30 days for the project's writers. The original is
 * downloadable once its scan is clean; a raw scan that never ran counts as
 * `failed` and the sweep scans it again.
 */
async function holdUnreadable(mail: InboundMailRow, raw: Uint8Array, automatic: boolean, evidence: SenderEvidence): Promise<boolean> {
  const current = await findMailForReceive(mail.id)
  if (!current || current.status !== 'received') return false
  if (current.rawScanStatus === 'pending') {
    await recordRawScan(mail.id, { status: 'failed', engine: null, signature: null, scannedAt: new Date() })
  }
  const verdict = evidence.verdict ?? uncheckedVerdict(mail.receivedAt, dateHeaderOf(raw))
  const flags = evidence.flags ?? verdict.flags
  const read = unreadableRead('failed')
  const fields: HeldMailFields = {
    ...senderFields(verdict, flags, mail, null),
    // No retry is left to wait for a write check here: one WorkOS does not answer is held unchecked.
    ...(await classified(mail, verdict, flags, automatic, true)),
    readStorageKey: null,
    automatic,
  }
  return holdMail(mail.id, fields, [textPartOf(mail, read, sha256Hex(''), [])])
}

/** The verdict of a mail whose sender could not be checked at all: unverified, nobody's member, and said so. */
function uncheckedVerdict(receivedAt: Date, sentAtHeader: Date | null): SenderVerdict {
  const clamped = clampSentAt(sentAtHeader, receivedAt)
  return {
    trust: 'external_unverified',
    senderUserId: null,
    flags: [...(clamped.outOfRange ? (['date_out_of_range'] as const) : []), 'sender_unchecked'],
    reason: 'verifier_error',
    signerDomain: null,
    signedHeaders: [],
    authenticationResults: '',
    sentAt: clamped.sentAt,
    sentAtHeader,
  }
}

// ---------------------------------------------------------------------------
// Steps 12-13: after the mail is held
// ---------------------------------------------------------------------------

/**
 * Everything that follows holding a mail, read back from the row so a run that
 * finds it held but not announced does the same. `raw` is the message when the
 * caller still has it; the follow check reads its header block for which
 * recipient fields it carries.
 */
async function afterHold(mailId: string, domain: string, raw: Uint8Array | null): Promise<void> {
  const mail = await findMailForReceive(mailId)
  if (!mail || mail.status !== 'waiting' || mail.notifiedAt || !mail.senderTrust) return
  const parts = await findPartSummaries(mail.id)
  const direct = mail.senderClass === 'verified_writer'
  // A verified writer's mail is filed by its sender; a follow would race it for the text.
  const followQueued = direct ? false : await queueFollowIfEligible(mail, parts, domain, raw)
  if (suggestionSkipReason(mail) === null) await queueSuggestion(mail)
  if (direct) await queueSenderFiling(mail)
  else await announceHeldMail({ ...mail, senderTrust: mail.senderTrust })
  publishProjectChanged(mail.organizationId, mail.projectId)
  const metadata = receivedMetadata(mail, parts, followQueued)
  recordAuditEventAfterCommit({
    organizationId: mail.organizationId,
    actor: { userId: SYSTEM_ACTORS.inboundMail, email: null },
    action: 'inbound_mail.received',
    targetType: 'inbound_mail',
    targetId: mail.id,
    alsoTargets: [{ type: 'project', id: mail.projectId }],
    metadata: { projectId: mail.projectId, ...metadata },
    idempotencyKey: `inbound_mail.received:${mail.id}`,
  })
  captureServer({
    event: 'inbound_mail_received',
    distinctId: null,
    organizationId: mail.organizationId,
    properties: {
      outcome: 'held',
      sender_trust: mail.senderTrust,
      sender_class: mail.senderClass,
      automatic: mail.automatic,
      attachments: metadata.attachments,
      size_bucket: sizeBucket(mail.rawSizeBytes ?? 0),
    },
  })
  await markNotified(mail.id)
}

/** The audit metadata of a held mail: codes, counts and flags only (the PII canary checks it). */
export function receivedMetadata(mail: InboundMailRow, parts: readonly PartSummary[], followQueued: boolean) {
  const attachments = parts.filter((part) => part.kind === 'attachment')
  const notStaged = Object.values(mail.ignored).reduce((sum: number, count) => sum + (count ?? 0), 0)
  return {
    senderTrust: mail.senderTrust ?? '',
    senderReason: mail.senderReason ?? '',
    senderFlags: mail.senderFlags.join(','),
    senderClass: mail.senderClass ?? '',
    automatic: mail.automatic,
    attachments: attachments.length,
    notStaged,
    riskFlags: [...new Set(attachments.flatMap((part) => part.riskFlags))].sort().join(','),
    rawScan: mail.rawScanStatus,
    unreadable: parts.some((part) => part.kind === 'message' && part.riskFlags.includes('unreadable')),
    threadMatches: mail.threadMatch.length,
    followQueued,
  }
}

/** PostHog's size bucket for a raw message, never the size itself. */
export function sizeBucket(bytes: number): string {
  if (bytes < 100 * 1024) return 'lt_100k'
  if (bytes < 1024 * 1024) return 'lt_1m'
  if (bytes < 10 * 1024 * 1024) return 'lt_10m'
  return 'ge_10m'
}

/** The agent's suggestion (D21), queued once per mail; the job reads the budget and the names itself. */
async function queueSuggestion(mail: InboundMailRow): Promise<void> {
  await insertJobIfAbsent({
    kind: 'inbound_mail_suggest',
    organizationId: mail.organizationId,
    priority: BFF_JOB_PRIORITY.bulk,
    jobId: inboundMailJobId('suggest', mail.id),
    payload: { mailId: mail.id, projectId: mail.projectId },
  })
}

/**
 * Step 12: queue the follow job when conditions 1–6 of D31 hold for the
 * thread the mail matched by reference. The job runs as the follower and
 * re-checks all nine; this only decides whether there is anything to check.
 * Whether a follow job was queued.
 */
async function queueFollowIfEligible(
  mail: InboundMailRow,
  parts: readonly PartSummary[],
  domain: string,
  raw: Uint8Array | null,
): Promise<boolean> {
  const contentFindings = parts.find((part) => part.kind === 'message')?.contentFindings.length ?? 0
  const judged = await judgeFollow(mail, contentFindings, domain, raw)
  if (!judged?.eligibility.eligible) return false
  const { follow } = judged.eligibility
  const directory = await loadOrganizationDirectory(mail.organizationId)
  const follower = directory.get(follow.userId)
  const session = await resolvePinnedRequesterSession({
    userId: follow.userId,
    email: follower?.email ?? null,
    organizationId: mail.organizationId,
  })
  // A follower who left the organization appends nothing; the follow job, which
  // ends such a follow, is not needed for that: the mail simply waits.
  if (!session) return false
  return insertJobIfAbsent({
    kind: 'inbound_mail_follow',
    organizationId: mail.organizationId,
    priority: BFF_JOB_PRIORITY.interactive,
    jobId: inboundMailJobId('follow', mail.id),
    payload: { projectId: mail.projectId, mailId: mail.id, followId: follow.id, requester: requesterOf(session) },
  })
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The class and code of an error, never its message (which may quote the mail). */
function errorName(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const code = 'code' in error && typeof error.code === 'string' ? `:${error.code}` : ''
  return `${error.name}${code}`
}
