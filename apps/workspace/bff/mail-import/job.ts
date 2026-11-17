import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  MAIL_IMPORT_LIFECYCLE,
  type MailImport,
  type MailImportErrorCode,
  type MailImportSkippedSample,
  type MailImportStatus,
} from '@/lib/db/schema/mail-imports'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { isAuthzRefusal } from '@/lib/api/errors'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { requireFolderWrite } from '@/lib/authz/folder-access'
import { resolveShelfFolderPath } from '@/lib/documents/folder-path'
import { requireShelfWrite } from '@/lib/documents/shelf-authz'
import { projectShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems } from '@/lib/inbox/service'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY, requesterOf, type JobSliceResult, type MailImportPayload } from '@/lib/jobs-queue/types'
import { findRootProjectFolderByName, getOrCreateProjectFolderByName } from '@/lib/projects/folder-service'
import { RENDER_LEASE_RETRY_MS } from '@/lib/mail-thread/append'
import { renderPendingThreads } from '@/lib/mail-thread/archive'
import { newThreadLocaleFor } from '@/lib/mail-thread/thread-locale'
import { readArchivePage, UnreadableArchiveError, type ArchiveItem, type ArchiveRef } from './archive-client'
import {
  MAIL_IMPORT_PAGE_SIZE,
  MAIL_IMPORT_RENDER_BUDGET_MS,
  MAIL_IMPORT_RETRY_BACKOFF_MINUTES,
  MAIL_IMPORT_ROOT_FOLDER,
  MAIL_IMPORT_SLICE_BUDGET_MS,
  SKIPPED_SAMPLES_KEPT,
  STALE_UPLOAD_HOURS,
  STALLED_IMPORT_MINUTES,
} from './config'
import {
  createFolderWithFreeName,
  fileMail,
  filingContext,
  ImportMovedOnError,
  MailImportQuotaError,
  SliceBudgetSpentError,
  ThreadBusyError,
  recordNameStops,
  type FiledMail,
  type FilingContext,
} from './filing'
import { archiveFolderName } from './naming'
import * as repository from './repository'
import { discardStaging } from './service'
import { archiveUrlForBackend } from './staging'
import { importBatchWithRoom, openImportBatch, sealImportBatch } from './upload-batch'

class PermanentImportFailure extends Error {
  constructor(
    readonly code: MailImportErrorCode,
    message: string,
  ) {
    super(message)
  }
}

interface Failure {
  code: MailImportErrorCode
  detail: string
}

const OPEN: readonly MailImportStatus[] = MAIL_IMPORT_LIFECYCLE.sourcesOf('complete')

const ARCHIVE_FOLDER_DELETED = 'The import’s folder was deleted (Papierkorb); nothing more is filed into it.'

export async function runMailImportSlice(
  session: AuthorizedSession | null,
  payload: MailImportPayload,
  organizationId: string,
): Promise<JobSliceResult<MailImportPayload>> {
  const done = { done: true, payload }
  const row = await repository.findMailImport(organizationId, payload.projectId, payload.importId)
  if (!row || !OPEN.includes(row.status)) return done
  if (!session) {
    await finish(row, 'failed', {
      code: 'requester_left',
      detail: 'The person who started the import is no longer a member of the organization.',
    })
    return done
  }
  try {
    const end = await fileUntilBudget(session, row)
    if (end === 'done') return done
    return end === 'more' ? { done: false, payload } : { done: false, payload, notBefore: end.notBefore }
  } catch (error) {
    const failure = failureOf(error)
    if (failure) {
      await finish(row, 'failed', failure)
      return done
    }
    console.warn(`[mail-import] ${row.id}: a slice failed; handing the import on`, error)
    await handOn(organizationId, payload, messageOf(error))
    return done
  }
}

async function handOn(organizationId: string, payload: MailImportPayload, detail: string): Promise<void> {
  const current = await repository.findMailImport(organizationId, payload.projectId, payload.importId)
  if (!current || !OPEN.includes(current.status)) return
  const streak = current.failureStreak + 1
  const backoff = MAIL_IMPORT_RETRY_BACKOFF_MINUTES[streak - 1]
  if (backoff === undefined) {
    await finish(current, 'failed', { code: 'stopped', detail: `Repeated errors: ${detail}` })
    return
  }
  const counted = await repository.updateMailImport(organizationId, current.id, OPEN, {
    failureStreak: streak,
    lastError: detail.slice(0, 1000),
  })
  if (!counted) return
  await enqueueJob({
    kind: 'mail_import',
    organizationId,
    priority: BFF_JOB_PRIORITY.bulk,
    payload,
    notBefore: new Date(Date.now() + backoff * 60_000),
  })
}

type SliceEnd = 'done' | 'more' | { notBefore: Date }

type FilingEnd = 'completed' | 'more' | 'moved_on' | 'busy'

async function fileUntilBudget(session: AuthorizedSession, initial: MailImport): Promise<SliceEnd> {
  const deadline = Date.now() + MAIL_IMPORT_SLICE_BUDGET_MS
  const context = await startSlice(session, initial, deadline)
  if (!context) return 'done'
  let filing: FilingEnd
  try {
    filing = await fileFrom(context, deadline)
  } catch (error) {
    if (error instanceof SliceBudgetSpentError) filing = 'more'
    else if (error instanceof ImportMovedOnError) filing = 'moved_on'
    else if (error instanceof ThreadBusyError) filing = 'busy'
    else {
      await renderQuietly(context, deadline)
      if (!(await archiveFolderLive(context.mailImport))) throw new PermanentImportFailure('stopped', ARCHIVE_FOLDER_DELETED)
      throw error
    }
  }
  const waiting = await renderThreads(context, deadline)
  announceToShelf(context.mailImport)
  if (filing === 'moved_on') return 'done'
  if (filing === 'busy' || waiting > 0) return { notBefore: new Date(Date.now() + RENDER_LEASE_RETRY_MS) }
  if (filing === 'more') return 'more'
  await finish(context.mailImport, 'completed', null)
  return 'done'
}

async function renderThreads(context: FilingContext, deadline: number): Promise<number> {
  const rendered = await renderPendingThreads(context, {
    uploadBatchId: async () => {
      context.threadBatch = context.threadBatch
        ? await importBatchWithRoom(context.session, context.mailImport, context.threadBatch)
        : await openImportBatch(context.session, context.mailImport, 'threads')
      return context.threadBatch.id
    },
    counted: () => {
      if (context.threadBatch) context.threadBatch.documents += 1
    },
    deadline: deadline + MAIL_IMPORT_RENDER_BUDGET_MS,
  })
  if (rendered.skipped.length > 0) await recordThreadSkips(context, rendered.skipped)
  if (rendered.quotaFull) throw new MailImportQuotaError()
  return rendered.waiting
}

async function renderQuietly(context: FilingContext, deadline: number): Promise<void> {
  try {
    await renderThreads(context, deadline)
  } catch (cause) {
    console.warn(`[mail-import] ${context.mailImport.id}: could not render its Verläufe before ending the slice`, cause)
  }
}

async function recordThreadSkips(
  context: FilingContext,
  skips: ReadonlyArray<{ name: string; reason: MailImportSkippedSample['reason'] }>,
): Promise<void> {
  const current = context.mailImport
  const samples = skips.map((skip) => ({ mail: skip.name, file: null, reason: skip.reason }))
  const skippedSamples = [...current.skippedSamples, ...samples].slice(0, SKIPPED_SAMPLES_KEPT)
  const recorded = await repository.recordSkippedFiles(current.organizationId, current.id, samples.length, skippedSamples)
  if (recorded) context.mailImport = { ...current, filesSkipped: current.filesSkipped + samples.length, skippedSamples }
}

async function fileFrom(context: FilingContext, deadline: number): Promise<FilingEnd> {
  while (Date.now() < deadline) {
    const page = await readArchivePage(context.archive, context.mailImport.nextPosition, MAIL_IMPORT_PAGE_SIZE)
    await recordTotal(context, page.total)
    for (const item of page.messages) {
      if (Date.now() >= deadline) return 'more'
      if (!(await fileItem(context, item))) return 'moved_on'
    }
    if (page.next_position === null) return 'completed'
  }
  return 'more'
}

async function startSlice(
  session: AuthorizedSession,
  initial: MailImport,
  deadline: number,
): Promise<FilingContext | null> {
  const running =
    initial.status === 'importing'
      ? initial
      : await repository.updateMailImport(initial.organizationId, initial.id, MAIL_IMPORT_LIFECYCLE.sourcesOf('start'), { status: 'importing' })
  if (!running) return null
  let archiveFolderId: string
  try {
    await requireShelfWrite(session, projectShelf(running.projectId))
    archiveFolderId = await ensureArchiveFolder(session, running)
  } catch (error) {
    if (!isRefusal(error)) throw error
    throw new PermanentImportFailure(
      'access',
      `The person who started the import may no longer add documents to this project or its ${MAIL_IMPORT_ROOT_FOLDER} folder.`,
    )
  }
  const archive: ArchiveRef = {
    key: running.stagingKey,
    url: await archiveUrlForBackend({ bucket: running.stagingBucket, key: running.stagingKey }),
    size: Number(running.sizeBytes),
  }
  const request = new Request('http://bff-jobs.internal/mail-import', { headers: { 'user-agent': 'piloti-mail-import' } })
  return filingContext({
    session,
    mailImport: { ...running, rootFolderId: archiveFolderId },
    archive,
    archiveFolderId,
    request,
    deadline,
    uploadBatch: await openImportBatch(session, running),
    locale: await newThreadLocaleFor(session),
  })
}

async function ensureArchiveFolder(session: AuthorizedSession, row: MailImport): Promise<string> {
  if (row.rootFolderId) {
    if (!(await archiveFolderLive(row))) throw new PermanentImportFailure('stopped', ARCHIVE_FOLDER_DELETED)
    await requireFolderWrite(session, row.projectId, [row.rootFolderId])
    return row.rootFolderId
  }
  const existing = await findRootProjectFolderByName(row.projectId, MAIL_IMPORT_ROOT_FOLDER, row.organizationId)
  await requireFolderWrite(session, row.projectId, [existing?.id ?? null])
  const root = await getOrCreateProjectFolderByName(row.projectId, MAIL_IMPORT_ROOT_FOLDER, row.organizationId)
  if (root.id !== existing?.id) await requireFolderWrite(session, row.projectId, [root.id])
  const folder = await createFolderWithFreeName({ session, mailImport: row }, root.id, archiveFolderName(row.filename))
  await repository.updateMailImport(row.organizationId, row.id, ['importing'], { rootFolderId: folder.id })
  return folder.id
}

async function archiveFolderLive(row: MailImport): Promise<boolean> {
  if (!row.rootFolderId) return true
  const path = await resolveShelfFolderPath(projectShelf(row.projectId), row.rootFolderId, row.organizationId)
  return path !== null
}

async function recordTotal(context: FilingContext, total: number): Promise<void> {
  if (context.mailImport.totalItems === total) return
  await repository.updateMailImport(context.mailImport.organizationId, context.mailImport.id, ['importing'], {
    totalItems: total,
  })
  context.mailImport = { ...context.mailImport, totalItems: total }
}

async function fileItem(context: FilingContext, item: ArchiveItem): Promise<boolean> {
  const current = context.mailImport
  const advance = {
    to: item.position + 1,
    mailsFiled: 0,
    filesFiled: 0,
    itemsSkipped: 0,
    filesSkipped: 0,
    threadsCreated: 0,
    threadsAppended: 0,
    alreadyInProject: 0,
  }
  let samples: MailImportSkippedSample[] = []
  let filedMail: FiledMail | null = null
  if (item.kind === 'other') {
    advance.itemsSkipped = 1
  } else if (item.kind === 'unreadable') {
    advance.itemsSkipped = 1
    samples = [{ mail: `#${item.position + 1}`, file: null, reason: 'unreadable' }]
  } else {
    const filed = await fileMail(context, item)
    Object.assign(advance, {
      mailsFiled: 1,
      filesFiled: filed.filesFiled,
      filesSkipped: filed.filesSkipped,
      threadsCreated: filed.threadsCreated,
      threadsAppended: filed.threadsAppended,
      alreadyInProject: filed.alreadyInProject,
    })
    samples = filed.skipped
    filedMail = filed
  }
  const skippedSamples = [...current.skippedSamples, ...samples].slice(0, SKIPPED_SAMPLES_KEPT)
  const moved = await repository.advanceMailImport(current.organizationId, current.id, item.position, {
    ...advance,
    skippedSamples,
  })
  if (!moved) return false
  if (filedMail) await recordNameStops(context, filedMail)
  context.mailImport = {
    ...current,
    nextPosition: advance.to,
    mailsFiled: current.mailsFiled + advance.mailsFiled,
    filesFiled: current.filesFiled + advance.filesFiled,
    itemsSkipped: current.itemsSkipped + advance.itemsSkipped,
    filesSkipped: current.filesSkipped + advance.filesSkipped,
    threadsCreated: current.threadsCreated + advance.threadsCreated,
    threadsAppended: current.threadsAppended + advance.threadsAppended,
    alreadyInProject: current.alreadyInProject + advance.alreadyInProject,
    skippedSamples,
    inflightPosition: null,
    inflightFolderId: null,
  }
  return true
}

async function finish(row: MailImport, status: 'completed' | 'failed', failure: Failure | null): Promise<void> {
  const ended = await repository.updateMailImport(row.organizationId, row.id, OPEN, {
    status,
    completedAt: new Date(),
    errorCode: failure?.code ?? null,
    lastError: failure?.detail.slice(0, 1000) ?? null,
    inflightPosition: null,
    inflightFolderId: null,
  })
  if (!ended) return
  announceToShelf(ended)
  await sealImportBatch(ended)
  try {
    await discardStaging(ended)
  } catch (cause) {
    console.error(`[mail-import] could not delete the staged archive of ${ended.id}:`, cause)
  }
  await announce(ended)
}

function announceToShelf(row: MailImport): void {
  publishShelfChanged(row.organizationId, projectShelf(row.projectId), { folders: true })
}

async function announce(row: MailImport): Promise<void> {
  const type = row.status === 'completed' ? 'mail_import.completed' : 'mail_import.failed'
  const anchorId = row.rootFolderId ?? `import:${row.id}`
  try {
    await emitInboxItems([
      {
        organizationId: row.organizationId,
        recipientUserId: row.userId,
        type,
        resourceType: 'project',
        resourceId: row.projectId,
        anchorId,
        actorUserId: null,
        groupKey: inboxGroupKey(type, 'project', row.projectId, anchorId),
        payload: { subject: row.filename, ...(row.rootFolderId ? { folderId: row.rootFolderId } : {}) },
      },
    ])
  } catch (cause) {
    console.error(`[mail-import] could not announce the end of ${row.id}:`, cause)
  }
}

function failureOf(error: unknown): Failure | null {
  if (error instanceof UnreadableArchiveError) return { code: 'unreadable', detail: error.message }
  if (error instanceof MailImportQuotaError) return { code: 'quota', detail: error.message }
  if (error instanceof PermanentImportFailure) return { code: error.code, detail: error.message }
  return null
}

function isRefusal(error: unknown): boolean {
  return isAuthzRefusal(error)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface MailImportSweepResult {
  checked: number
  aborted: number
  requeued: number
  failed: number
  waiting: number
  errors: number
}

export async function sweepStaleMailImports(now: Date = new Date(), batch = 50): Promise<MailImportSweepResult> {
  const uploadsBefore = new Date(now.getTime() - STALE_UPLOAD_HOURS * 3_600_000)
  const stalledBefore = new Date(now.getTime() - STALLED_IMPORT_MINUTES * 60_000)
  const rows = await withPlatformAccess('mail import sweep: finding imports left open without progress', () =>
    repository.listStaleOpenImports(uploadsBefore, stalledBefore, batch),
  )
  const result: MailImportSweepResult = { checked: rows.length, aborted: 0, requeued: 0, failed: 0, waiting: 0, errors: 0 }
  for (const row of rows) {
    try {
      const verdict = await withTenant({ organizationId: row.organizationId }, () => settleStale(row))
      result[verdict] += 1
    } catch (error) {
      console.error('[mail-import] could not settle the stale import', row.id, error)
      result.errors += 1
    }
  }
  return result
}

async function settleStale(row: MailImport): Promise<'aborted' | 'requeued' | 'failed' | 'waiting'> {
  if (!OPEN.includes(row.status) && row.status !== 'uploading') {
    await discardStaging(row)
    return 'aborted'
  }
  if (row.status === 'uploading') {
    const ended = await repository.updateMailImport(row.organizationId, row.id, ['uploading'], {
      status: 'cancelled',
      completedAt: new Date(),
      errorCode: 'upload_expired',
      lastError: 'The archive was not sent completely within two days.',
    })
    if (ended) await discardStaging(ended)
    return 'aborted'
  }
  const job = await findOpenJobId({ kind: 'mail_import', organizationId: row.organizationId, matching: { importId: row.id } })
  if (job) return 'waiting'
  return (await requeue(row)) ? 'requeued' : 'failed'
}

async function requeue(row: MailImport): Promise<boolean> {
  const session = await resolvePinnedRequesterSession({
    userId: row.userId,
    email: row.userEmail,
    organizationId: row.organizationId,
  })
  if (!session) {
    await finish(row, 'failed', {
      code: 'requester_left',
      detail: 'The person who started the import is no longer a member of the organization.',
    })
    return false
  }
  const streak = row.failureStreak + 1
  if (streak > MAIL_IMPORT_RETRY_BACKOFF_MINUTES.length) {
    await finish(row, 'failed', { code: 'stalled', detail: 'The import job kept stopping without finishing.' })
    return false
  }
  const counted = await repository.updateMailImport(row.organizationId, row.id, OPEN, { failureStreak: streak })
  if (!counted) return false
  await enqueueJob({
    kind: 'mail_import',
    organizationId: row.organizationId,
    priority: BFF_JOB_PRIORITY.bulk,
    payload: { importId: row.id, projectId: row.projectId, requester: requesterOf(session) },
  })
  return true
}
