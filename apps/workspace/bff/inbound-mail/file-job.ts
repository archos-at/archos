import 'server-only'

import { createHash } from 'node:crypto'
import type { AuthorizedSession } from '@/lib/auth/types'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import type { AccessFolder } from '@/lib/authz/folder-access-rule'
import type { InboundMailDecisionRow, InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { memberReader } from '@/lib/documents/document-reader'
import { uploadDocument } from '@/lib/documents/document-dispatch'
import { documentTypeOf } from '@/lib/documents/tag-vocabulary'
import type { InboundMailFilePayload, JobSliceResult } from '@/lib/jobs-queue/types'
import {
  appendInboundMessage,
  ensureTargetFolder,
  RENDER_LEASE_RETRY_MS,
  uploadOrFailure,
  type AttachmentFact,
} from '@/lib/mail-thread/append'
import { mailOriginIngestFacts } from '@/lib/mail-thread/ingest-facts'
import { domainOf } from '@/lib/mail-thread/mail-threading'
import type { MailThreadLocale } from '@/lib/mail-thread/mail-thread-vocabulary'
import { extendFollowsOnFiling, followByDefault } from '@/lib/mail-thread/follows'
import { finishOriginalMove } from '@/lib/mail-thread/originals'
import { newThreadLocaleFor } from '@/lib/mail-thread/thread-locale'
import {
  decidePendingAttachment,
  findCurrentVersions,
  findEntryOfMail,
  findThreadRow,
  findVersionTimes,
} from '@/lib/mail-thread/write-repository'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { chatScreeningRules } from '@/lib/upload-screening/content-screen'
import { gatePolicy } from '@/lib/upload-screening/service'
import { announceDecided, announceFilingFailed, settleFilingFailed, settleHeld, settleProjectNotices } from './announce'
import { INBOUND_ATTACHMENT_EFFECTS, INBOUND_THREAD_APPEND_EFFECTS } from './batch-effects'
import {
  findFilingWork,
  forgetFiledBytes,
  markAttachmentFiled,
  projectIsHeld,
  recordFilingScan,
  renewClaim,
  renewClaims,
  returnPartToWaiting,
  settleFiledMail,
  type FilingWork,
} from './filing-repository'
import { scanForStorage } from './malware-scan'
import { partOutcomesOf } from './notice-repository'
import { openQuietBatch, sealQuietBatch } from './quiet-batch'
import { inboundMailDomain, redactProjectAddresses } from './address'
import { mailReadSchema, redactRead, type MailRead } from './read-client'
import { FILING_CLAIM_MS } from './service'
import { eraseStagedObjects, readStagedObjectIfHeld } from './staging'

export const RESCAN_AFTER_MS = 24 * 60 * 60 * 1000

const jobRequest = (): Request =>
  new Request('http://bff-jobs.internal/inbound-mail-file', {
    headers: { 'user-agent': 'inbound-mail' },
  })

interface FilingRun {
  session: AuthorizedSession
  projectId: string
  owns: (decision: InboundMailDecisionRow) => boolean
  follows: (decision: InboundMailDecisionRow) => boolean
  keepClaims: () => Promise<void>
  request: Request
  once: <T>(key: string, load: () => Promise<T>) => Promise<T>
}

function filingRun(session: AuthorizedSession, payload: InboundMailFilePayload): FilingRun {
  const cache = new Map<string, Promise<unknown>>()
  const named = new Set(payload.decisionIds ?? [])
  const unfollowed = new Set(payload.noFollow ?? [])
  let renewedAt = Number.NEGATIVE_INFINITY
  return {
    session,
    projectId: payload.projectId,
    owns: (decision) => decision.decidedBy === session.userId && named.has(decision.id),
    follows: (decision) => decision.via === 'app' && !unfollowed.has(decision.id),
    keepClaims: async () => {
      if (Date.now() - renewedAt < FILING_CLAIM_MS / 5) return
      renewedAt = Date.now()
      await renewClaims([...named], new Date(renewedAt + FILING_CLAIM_MS))
    },
    request: jobRequest(),
    once: <T>(key: string, load: () => Promise<T>) => {
      if (!cache.has(key)) cache.set(key, load())
      return cache.get(key) as Promise<T>
    },
  }
}

const attachmentBatch = (run: FilingRun) =>
  run.once('batch:attachments', () =>
    openQuietBatch(run.session, run.projectId, INBOUND_ATTACHMENT_EFFECTS)
  )
const threadBatch = (run: FilingRun) =>
  run.once('batch:thread', () =>
    openQuietBatch(run.session, run.projectId, INBOUND_THREAD_APPEND_EFFECTS)
  )
const held = (run: FilingRun) =>
  run.once('held', () => projectIsHeld(run.projectId, run.session.organizationId))

const newThreadLocale = (run: FilingRun): Promise<MailThreadLocale> =>
  run.once('locale', () => newThreadLocaleFor(run.session))

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function ownWork(run: FilingRun, work: FilingWork): FilingWork {
  const decisions = new Map([...work.decisions].filter(([, decision]) => run.owns(decision)))
  return { ...work, decisions }
}

export async function runInboundMailFiling(
  session: AuthorizedSession,
  payload: InboundMailFilePayload
): Promise<JobSliceResult<InboundMailFilePayload>> {
  const run = filingRun(session, payload)
  const work = (await findFilingWork(payload.projectId, payload.mailIds)).map((mail) =>
    ownWork(run, mail)
  )
  if (work.length === 0) return { done: true, payload }
  let busy = false
  const busyThreads = new Set<string>()
  try {
    for (const mail of work) {
      const thread = appendTarget(mail)
      if (thread && busyThreads.has(thread)) {
        busy = true
        continue
      }
      await run.keepClaims()
      if ((await fileMail(run, mail)) !== 'busy') continue
      busy = true
      if (thread) busyThreads.add(thread)
    }
  } finally {
    for (const key of ['batch:attachments', 'batch:thread']) {
      const opened = await run.once<string | null>(key, async () => null).catch(() => null)
      if (opened) await sealQuietBatch(session, opened)
    }
    publishProjectChanged(session.organizationId, payload.projectId)
  }
  return busy
    ? { done: false, payload, notBefore: new Date(Date.now() + RENDER_LEASE_RETRY_MS) }
    : { done: true, payload }
}

function appendTarget(work: FilingWork): string | null {
  const message = work.parts.find((part) => part.kind === 'message' && part.state === 'filing')
  const decision = message ? work.decisions.get(message.id) : undefined
  return decision?.threadAction === 'append' ? decision.mailThreadId : null
}

async function fileMail(run: FilingRun, work: FilingWork): Promise<'done' | 'busy'> {
  await finishInterruptedMove(run, work.mail)
  const filedNow: Array<{
    part: InboundMailPartRow
    documentId: string
    versionId: string | null
  }> = []
  for (const part of work.parts) {
    const decision = work.decisions.get(part.id)
    if (part.kind !== 'attachment' || part.state !== 'filing' || !decision) continue
    await run.keepClaims()
    const filed = await fileAttachment(run, work, part, decision)
    if (filed) filedNow.push({ part, ...filed })
  }

  let outcome: 'done' | 'busy' = 'done'
  const message = work.parts.find((part) => part.kind === 'message' && part.state === 'filing')
  const messageDecision = message ? work.decisions.get(message.id) : undefined
  if (message && messageDecision) outcome = await fileText(run, work.mail, message, messageDecision)
  else await linkLateAttachments(run, work.mail, filedNow)

  await settleIfFiled(run, work.mail.id)
  await tellOutcome(run, work)
  return outcome
}

async function tellOutcome(run: FilingRun, work: FilingWork): Promise<void> {
  const claimed = work.parts.filter((part) => part.state === 'filing' && work.decisions.has(part.id))
  if (claimed.length === 0) return
  const now = new Map((await partOutcomesOf(work.mail.id)).map((part) => [part.id, part]))
  const failed = claimed.find((part) => now.get(part.id)?.state === 'waiting' && now.get(part.id)?.lastFailure)
  const failure = failed ? now.get(failed.id)?.lastFailure : null
  if (failed && failure) {
    await announceFilingFailed({
      organizationId: run.session.organizationId,
      projectId: run.projectId,
      mailId: work.mail.id,
      decidedBy: work.decisions.get(failed.id)?.decidedBy ?? run.session.userId,
      failure,
    })
  }
  const filedNow = claimed.some((part) => now.get(part.id)?.state === 'filed')
  const open = [...now.values()].some((part) => part.state === 'waiting' || part.state === 'filing')
  if (!filedNow || open) return
  await settleFilingFailed(run.session.organizationId, [work.mail.id])
  await settleHeld(run.session.organizationId, [work.mail.id])
  await announceDecided({
    organizationId: run.session.organizationId,
    projectId: run.projectId,
    mailId: work.mail.id,
    senderTrust: work.mail.senderTrust,
    senderUserId: work.mail.senderUserId,
    senderFlags: work.mail.senderFlags,
    decidedBy: run.session.userId,
    outcome: 'filed',
    direct: claimed.every((part) => work.decisions.get(part.id)?.via === 'sender'),
  })
}

async function finishInterruptedMove(run: FilingRun, mail: InboundMailRow): Promise<void> {
  if (!mail.originalMovePendingAt || !mail.rawStorageKey) return
  const entry = await findEntryOfMail(run.projectId, mail.id)
  if (entry) await finishOriginalMove(mail, entry)
}

function messageOf(mail: InboundMailRow) {
  return {
    sentAt: mail.sentAt ?? mail.receivedAt,
    receivedAt: mail.receivedAt,
    senderName: mail.senderName,
    senderDomain: domainOf(mail.senderAddress),
    signerDomain: mail.signerDomain,
    senderTrust: mail.senderTrust ?? 'external_unverified',
    author:
      mail.originalAuthorName || mail.originalAuthorAddress
        ? { name: mail.originalAuthorName, address: mail.originalAuthorAddress, sentAt: mail.originalSentAt }
        : null,
  } as const
}

async function threadOf(
  run: FilingRun,
  work: FilingWork
): Promise<{ documentId: string | null; locale: MailThreadLocale }> {
  const message = work.parts.find((part) => part.kind === 'message')
  const decision = message ? work.decisions.get(message.id) : undefined
  const threadId =
    decision?.mailThreadId ??
    (message?.mailThreadEntryId
      ? (await findEntryOfMail(run.projectId, work.mail.id))?.threadId
      : null)
  const thread = threadId ? await findThreadRow(run.projectId, threadId) : null
  if (thread) return { documentId: thread.documentId, locale: thread.locale }
  return { documentId: null, locale: await newThreadLocale(run) }
}

async function fileAttachment(
  run: FilingRun,
  work: FilingWork,
  part: InboundMailPartRow,
  decision: InboundMailDecisionRow
): Promise<{ documentId: string; versionId: string | null } | null> {
  const { mail } = work
  if (!(await renewClaim(part.id, decision.id, new Date(Date.now() + FILING_CLAIM_MS)))) return null
  const fail = async (
    failure: Parameters<typeof returnPartToWaiting>[2],
    scan?: Parameters<typeof returnPartToWaiting>[3]
  ) => {
    await returnPartToWaiting(part.id, decision.id, failure, scan)
    return null
  }
  if (!part.storageKey) return fail('unavailable')
  const bytes = await readStagedObjectIfHeld(mail.stagingBucket, part.storageKey)
  if (!bytes) return fail('unavailable')
  if (!part.scannedAt || Date.now() - new Date(part.scannedAt).getTime() > RESCAN_AFTER_MS) {
    const scan = await scanForStorage(bytes)
    if (scan.status !== 'clean') return fail('scan_not_clean', scan)
    await recordFilingScan(part.id, decision.id, scan)
  }
  if (sha256(bytes) !== part.sha256) return fail('digest_mismatch')

  const folder = await ensureTargetFolder(run.session, run.projectId, {
    folderId: decision.folderId,
    folderPath: decision.folderId ? null : decision.folderPath,
  })
  if (!folder.ok) return fail(folder.failure)
  const thread = await threadOf(run, work)
  const documentType = documentTypeOf([decision.documentType ?? ''])
  const uploaded = await uploadOrFailure(async () =>
    uploadDocument(
      run.session,
      {
        projectId: run.projectId,
        folderId: folder.folderId,
        file: new File(
          [new Uint8Array(bytes)],
          decision.fileName ?? part.filename ?? `attachment-${part.position}`,
          { type: part.contentType }
        ),
        revisionOf: decision.targetDocumentId,
        screeningRelease: decision.screeningRelease,
        uploadBatchId: await attachmentBatch(run),
        ...(documentType ? { documentType } : {}),
        mailOrigin: mailOriginIngestFacts(messageOf(mail), {
          threadDocumentId: thread.documentId,
          locale: thread.locale,
        }),
      },
      run.request
    )
  )
  if (!uploaded.ok) return fail(uploaded.failure)

  const documentId = uploaded.value.documentId
  const versionId =
    (await findCurrentVersions([documentId], memberReader(run.session.userId))).get(documentId)
      ?.versionId ?? null
  if (!(await markAttachmentFiled(part.id, decision.id, { documentId, versionId }))) {
    console.warn(
      `[inbound-mail] part ${part.id} of mail ${mail.id} lost its claim while document ${documentId} was uploaded; its bytes stay staged and it is not filed`
    )
    return null
  }
  if (
    !(await held(run)) &&
    (await eraseStagedObjects(mail.stagingBucket, [part.storageKey])).length === 0
  ) {
    await forgetFiledBytes(part.id, part.storageKey)
  }
  return { documentId, versionId }
}

async function fileText(
  run: FilingRun,
  filedMail: InboundMailRow,
  part: InboundMailPartRow,
  decision: InboundMailDecisionRow
): Promise<'done' | 'busy'> {
  if (!(await renewClaim(part.id, decision.id, new Date(Date.now() + FILING_CLAIM_MS))))
    return 'done'
  const [found] = await findFilingWork(run.projectId, [filedMail.id])
  if (!found) return 'done'
  const fresh = ownWork(run, found)
  const { mail } = fresh
  if (!mail.readStorageKey) {
    await returnPartToWaiting(part.id, decision.id, 'unreadable')
    return 'done'
  }
  const read = await readStagedObjectIfHeld(mail.stagingBucket, mail.readStorageKey)
  if (!read) {
    await returnPartToWaiting(part.id, decision.id, 'unreadable')
    return 'done'
  }
  const staged = mailReadSchema.parse(JSON.parse(new TextDecoder().decode(read)))
  const filed = filedForm(mail, staged)
  const folder =
    decision.threadAction === 'create'
      ? await ensureTargetFolder(run.session, run.projectId, {
          folderId: decision.folderId,
          folderPath: decision.folderId ? null : decision.folderPath,
        })
      : { ok: true as const, folderId: null }
  if (!folder.ok) {
    await returnPartToWaiting(part.id, decision.id, folder.failure)
    return 'done'
  }

  const outcome = await appendInboundMessage({
    session: run.session,
    mail: filed.mail,
    part,
    decision,
    read: filed.read,
    form: {
      masked: decision.messageText === 'masked',
      rules: chatScreeningRules(
        await run.once('policy', () => gatePolicy(run.session.organizationId, run.projectId))
      ),
    },
    attachments: await attachmentFacts(run, fresh),
    folderTree: await run.once(
      'tree',
      async () =>
        new Map(
          (await listProjectFolderTree(run.session.organizationId, run.projectId)).map(
            (folder): [string, AccessFolder] => [folder.id, folder]
          )
        )
    ),
    newThreadFolderId: folder.folderId,
    newThreadLocale: await newThreadLocale(run),
    uploadBatchId: await threadBatch(run),
    request: run.request,
  })
  if (outcome.kind === 'busy') return 'busy'
  if (outcome.kind === 'failed') {
    await returnPartToWaiting(part.id, decision.id, outcome.failure)
    return 'done'
  }
  await finishOriginalMove(mail, { id: outcome.entryId, originalStorageKey: null })
  await extendFiledThreadFollows(run, outcome.threadId)
  if (run.follows(decision)) await followFiledThread(run, outcome.threadId)
  return 'done'
}

async function extendFiledThreadFollows(run: FilingRun, threadId: string): Promise<void> {
  try {
    await extendFollowsOnFiling(run.session.organizationId, threadId)
  } catch (error) {
    console.warn(`[inbound-mail] the follows of mail thread ${threadId} were not extended; the text is filed`, error)
  }
}

async function followFiledThread(run: FilingRun, threadId: string): Promise<void> {
  try {
    const followed = await followByDefault(run.session, run.projectId, threadId)
    if (followed === 'refused') console.warn(`[inbound-mail] no follow was started on mail thread ${threadId}: the filer may not follow it`)
  } catch (error) {
    console.warn(`[inbound-mail] no follow was started on mail thread ${threadId}; the text is filed`, error)
  }
}

async function attachmentFacts(run: FilingRun, work: FilingWork): Promise<AttachmentFact[]> {
  const attachments = work.parts.filter((part) => part.kind === 'attachment')
  const reader = memberReader(run.session.userId)
  const documentIds = attachments.flatMap((part) =>
    part.documentId
      ? [part.documentId]
      : part.duplicateOfDocumentId
        ? [part.duplicateOfDocumentId]
        : []
  )
  const [documents, versionTimes] = await Promise.all([
    findCurrentVersions(documentIds, reader),
    findVersionTimes(
      attachments.flatMap((part) => (part.documentVersionId ? [part.documentVersionId] : [])),
      reader
    ),
  ])
  return attachments.map((part) => {
    const decision = work.decisions.get(part.id) ?? null
    if (part.state === 'filed' && part.documentId) {
      const current = documents.get(part.documentId)
      return {
        part,
        decision,
        document: current
          ? {
              id: part.documentId,
              versionId: part.documentVersionId,
              versionCreatedAt: part.documentVersionId
                ? (versionTimes.get(part.documentVersionId) ?? null)
                : null,
              folderId: current.folderId,
            }
          : null,
      }
    }
    const duplicate = part.duplicateOfDocumentId
      ? documents.get(part.duplicateOfDocumentId)
      : undefined
    return {
      part,
      decision,
      document: duplicate
        ? {
            id: duplicate.documentId,
            versionId: duplicate.versionId,
            versionCreatedAt: duplicate.versionCreatedAt,
            folderId: duplicate.folderId,
          }
        : null,
    }
  })
}

async function linkLateAttachments(
  run: FilingRun,
  mail: InboundMailRow,
  filed: ReadonlyArray<{ part: InboundMailPartRow; documentId: string; versionId: string | null }>
): Promise<void> {
  if (filed.length === 0) return
  const entry = await findEntryOfMail(run.projectId, mail.id)
  if (!entry) return
  const times = await findVersionTimes(
    filed.flatMap((item) => (item.versionId ? [item.versionId] : [])),
    memberReader(run.session.userId)
  )
  for (const item of filed) {
    const createdAt = item.versionId ? times.get(item.versionId) : undefined
    const present = Boolean(createdAt && createdAt < new Date(mail.receivedAt))
    await decidePendingAttachment(entry.id, item.part.position, {
      disposition: present ? 'already_present' : 'filed',
      documentId: item.documentId,
      versionId: item.versionId,
    })
  }
}

async function settleIfFiled(run: FilingRun, mailId: string): Promise<void> {
  const [work] = await findFilingWork(run.projectId, [mailId])
  if (!work || work.parts.some((part) => part.state !== 'filed')) return
  const { mail } = work
  const keys = [mail.readStorageKey, mail.originalMovePendingAt ? null : mail.rawStorageKey].filter(
    (key): key is string => key !== null
  )
  const deferred =
    (await held(run)) || (await eraseStagedObjects(mail.stagingBucket, keys)).length > 0
  if (!(await settleFiledMail(mail, deferred))) return
  await settleProjectNotices(run.session.organizationId, run.projectId)
}

export function filedForm<M extends { participants: readonly { address: string }[] }>(
  mail: M,
  read: MailRead,
  domain: string | null = inboundMailDomain()
): { mail: M; read: MailRead } {
  if (!domain) return { mail, read }
  const redact = (text: string) => redactProjectAddresses(text, domain)
  return {
    mail: { ...mail, participants: mail.participants.map((p) => ({ ...p, address: redact(p.address) })) },
    read: redactRead(read, redact),
  }
}
