import 'server-only'

import { randomUUID } from 'node:crypto'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds, requireFolderWrite } from '@/lib/authz/folder-access'
import { requireMailReviewer } from '@/lib/inbound-mail/access'
import { announceFollowsEnded, settleFollowExpiring } from '@/lib/inbound-mail/announce'
import { INBOUND_THREAD_APPEND_EFFECTS } from '@/lib/inbound-mail/batch-effects'
import { findDocumentIdByStoredName, findLiveFolders } from '@/lib/inbound-mail/repository'
import { openQuietBatch, sealQuietBatch } from '@/lib/inbound-mail/quiet-batch'
import { normalizeFolderPath } from '@/lib/projects/folders'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { screenUploadName } from '@/lib/upload-screening/name-screen'
import { gatePolicy } from '@/lib/upload-screening/service'
import { memberReader } from '@/lib/documents/document-reader'
import {
  ensureTargetFolder,
  RENDER_LEASE_MS,
  renderEntriesOf,
  threadDocumentFilename,
  threadTitleOf,
  uploadThreadVersion,
  type ThreadVersionResult,
} from './append'
import { mailThreadIngestFacts } from './ingest-facts'
import { clampSentAt, domainOf } from './mail-threading'
import type {
  MailThreadEntryDetachBody,
  MailThreadEntryDetachResultView,
  MailThreadRefusal,
} from './mail-thread-wire'
import {
  MAIL_THREAD_MAX_ENTRIES,
  MAIL_THREAD_MAX_RENDERED_BYTES,
  type MailThreadLocale,
} from './mail-thread-vocabulary'
import { mailThreadEntryHeading, renderMailThread, type MailThreadRenderEntry } from './render'
import { findVisibleThread } from './repository'
import {
  acquireRenderLease,
  commitDetach,
  findThreadEntryRows,
  findWritableThread,
  releaseRenderLease,
  type WritableThread,
} from './write-repository'

export function threadRefusal(
  reason: MailThreadRefusal,
  message: string,
  details: Record<string, string | number> = {}
): ConflictError {
  return new ConflictError(message, { reason, ...details })
}

type Destination =
  | { kind: 'existing'; target: WritableThread }
  | {
      kind: 'new'
      threadId: string
      folderId: string | null
      folderPath: string
      filename: string
      screeningRelease: boolean
    }

const lastEntryAtOf = (entries: readonly MailThreadRenderEntry[]): Date | null =>
  entries.length === 0
    ? null
    : new Date(
        Math.max(
          ...entries.map((entry) => clampSentAt(entry.sentAt, entry.receivedAt).sentAt.getTime())
        )
      )

async function writableThread(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  hidden: readonly string[],
  notFound: () => Error
): Promise<WritableThread> {
  const visible = await findVisibleThread(projectId, threadId, hidden)
  const writable = visible
    ? await findWritableThread(projectId, threadId, memberReader(session.userId))
    : null
  if (!writable) throw notFound()
  return writable
}

async function destinationOf(
  session: AuthorizedSession,
  projectId: string,
  sourceThreadId: string,
  body: MailThreadEntryDetachBody,
  hidden: readonly string[]
): Promise<Destination> {
  const { target } = body
  if (target.action === 'append') {
    const unknown = () =>
      threadRefusal('target_unknown', 'The mail thread to move the message into was not found', {
        mailThreadId: target.mailThreadId,
      })
    if (target.mailThreadId === sourceThreadId) throw unknown()
    const thread = await writableThread(session, projectId, target.mailThreadId, hidden, unknown)
    if (thread.thread.entryCount >= MAIL_THREAD_MAX_ENTRIES) {
      throw threadRefusal(
        'thread_full',
        'The mail thread is full; move the message into a new thread',
        { mailThreadId: target.mailThreadId }
      )
    }
    return { kind: 'existing', target: thread }
  }
  let folderPath = normalizeFolderPath(target.newFolderPath)
  if (target.folderId) {
    const path = (await findLiveFolders(projectId, [target.folderId])).get(target.folderId)
    if (path === undefined || hidden.includes(target.folderId)) {
      throw threadRefusal('target_unknown', 'The folder was not found', {
        folderId: target.folderId,
      })
    }
    folderPath = path
  }
  const filename = threadDocumentFilename(target.name)
  const released = target.screeningRelease === 'name'
  const terms = screenUploadName(await gatePolicy(session.organizationId, projectId), {
    filename,
    folderPath: folderPath || null,
  }).matches
  if (terms.length > 0 && !released) {
    throw threadRefusal(
      'name_stop',
      'The name check stopped this name; choose another or release it (screeningRelease)'
    )
  }
  if (await findDocumentIdByStoredName(projectId, filename)) {
    throw threadRefusal(
      'name_taken',
      'A document of this name is already in the project; choose another name'
    )
  }
  return {
    kind: 'new',
    threadId: randomUUID(),
    folderId: target.folderId ?? null,
    folderPath,
    filename,
    screeningRelease: released,
  }
}

export async function detachMailThreadEntry(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  entryId: string,
  body: MailThreadEntryDetachBody,
  request: Request
): Promise<MailThreadEntryDetachResultView> {
  await requireMailReviewer(session, projectId)
  const hidden = await getHiddenFolderIds(session, projectId)
  const source = await writableThread(
    session,
    projectId,
    threadId,
    hidden,
    () => new NotFoundError('Mail thread not found')
  )
  const destination = await destinationOf(session, projectId, threadId, body, hidden)
  await requireFolderWrite(session, projectId, [
    source.document.folderId,
    destination.kind === 'existing' ? destination.target.document.folderId : destination.folderId,
  ])

  const holder = randomUUID()
  const until = new Date(Date.now() + RENDER_LEASE_MS)
  const leased: string[] = []
  try {
    for (const id of destination.kind === 'existing'
      ? [threadId, destination.target.thread.id]
      : [threadId]) {
      if (!(await acquireRenderLease(id, holder, until))) {
        throw threadRefusal(
          'busy',
          'A mail is being filed into this thread right now; try again in a moment',
          { mailThreadId: id }
        )
      }
      leased.push(id)
    }
    return await moveEntry(session, { projectId, source, destination, entryId, request })
  } finally {
    for (const id of leased) await releaseRenderLease(id, holder)
  }
}

async function moveEntry(
  session: AuthorizedSession,
  move: {
    projectId: string
    source: WritableThread
    destination: Destination
    entryId: string
    request: Request
  }
): Promise<MailThreadEntryDetachResultView> {
  const { projectId, source, destination } = move
  const sourceRows = await findThreadEntryRows(source.thread.id)
  const moving = sourceRows.find((row) => row.id === move.entryId)
  if (!moving) throw new NotFoundError('Mail not found')
  if (sourceRows.length === 1) {
    throw threadRefusal(
      'last_entry',
      'This is the only message of its thread; delete or move the thread document instead'
    )
  }
  const sourceEntries = await renderEntriesOf(sourceRows)
  const remaining = sourceEntries.filter((entry) => entry.id !== moving.id)
  const movingEntry = sourceEntries.find((entry) => entry.id === moving.id)!

  const targetRows =
    destination.kind === 'existing' ? await findThreadEntryRows(destination.target.thread.id) : []
  const targetLocale: MailThreadLocale =
    destination.kind === 'existing' ? destination.target.thread.locale : source.thread.locale
  const movedAt = new Date()
  const heading = mailThreadEntryHeading(
    movingEntry,
    targetRows.map((row) => row.heading),
    targetLocale
  )
  const targetEntries = [
    ...(await renderEntriesOf(targetRows)),
    { ...movingEntry, heading, filedAt: movedAt, inReplyToEntryId: null },
  ]

  const sourceRendition = renderMailThread({
    title: threadTitleOf(source.document.filename),
    locale: source.thread.locale,
    continues: null,
    entries: remaining,
  })
  const targetFilename =
    destination.kind === 'existing' ? destination.target.document.filename : destination.filename
  const targetRendition = renderMailThread({
    title: threadTitleOf(targetFilename),
    locale: targetLocale,
    continues: null,
    entries: targetEntries,
  })
  if (targetRendition.bytes > MAIL_THREAD_MAX_RENDERED_BYTES) {
    throw threadRefusal(
      'thread_full',
      'The mail thread would grow past its size; move the message into a new thread'
    )
  }

  const batchId = await openQuietBatch(session, projectId, INBOUND_THREAD_APPEND_EFFECTS)
  try {
    const left = refusedOr(
      await uploadThreadVersion({
        session,
        projectId,
        folderId: source.document.folderId,
        filename: source.document.filename,
        markdown: sourceRendition.markdown,
        facts: mailThreadIngestFacts(remaining, source.thread.locale),
        current: source.document,
        screeningRelease: false,
        uploadBatchId: batchId,
        request: move.request,
      })
    )
    const folder =
      destination.kind === 'new'
        ? await ensureTargetFolder(session, projectId, {
            folderId: destination.folderId,
            folderPath: destination.folderPath,
          })
        : null
    if (folder && !folder.ok)
      throw threadRefusal('upload_refused', 'The new thread’s folder could not be used', {
        failure: folder.failure,
      })
    const joined = refusedOr(
      await uploadThreadVersion({
        session,
        projectId,
        folderId:
          destination.kind === 'existing'
            ? destination.target.document.folderId
            : folder?.ok
              ? folder.folderId
              : null,
        filename: targetFilename,
        markdown: targetRendition.markdown,
        facts: mailThreadIngestFacts(targetEntries, targetLocale),
        current: destination.kind === 'existing' ? destination.target.document : null,
        screeningRelease: destination.kind === 'new' && destination.screeningRelease,
        uploadBatchId: batchId,
        request: move.request,
      })
    )
    const toThreadId =
      destination.kind === 'existing' ? destination.target.thread.id : destination.threadId
    const domains = [
      ...(destination.kind === 'existing' ? destination.target.thread.participantDomains : []),
      ...[
        moving.senderAddress,
        ...movingEntry.participants.map((participant) => participant.address),
      ].flatMap((address) => domainOf(address) ?? []),
    ]
    const ended = await commitDetach({
      entryId: moving.id,
      fromThreadId: source.thread.id,
      toThreadId,
      newThread:
        destination.kind === 'new'
          ? {
              id: toThreadId,
              organizationId: session.organizationId,
              projectId,
              documentId: joined.documentId,
              baseSubject: moving.baseSubject ?? source.thread.baseSubject,
              threadIndexGuid: moving.threadIndexGuid,
              locale: targetLocale,
              createdBy: session.userId,
            }
          : null,
      heading,
      fromThreadUpdate: {
        entryCount: remaining.length,
        renderedBytes: sourceRendition.bytes,
        lastEntryAt: lastEntryAtOf(remaining),
      },
      toThreadUpdate: {
        documentId: joined.documentId,
        entryCount: targetEntries.length,
        renderedBytes: targetRendition.bytes,
        lastEntryAt: lastEntryAtOf(targetEntries),
        participantDomains: [...new Set(domains)].slice(0, 200),
      },
      firstVersionId: joined.versionId,
      movedAt,
    })
    recordDetach(session, {
      projectId,
      entryId: moving.id,
      fromThreadId: source.thread.id,
      toThreadId,
      created: destination.kind === 'new',
      ended,
    })
    await settleFollowExpiring(session.organizationId, ended.map((follow) => follow.id))
    await announceFollowsEnded(session.organizationId, projectId, ended, 'detached', session.userId)
    return {
      entryId: moving.id,
      from: { threadId: source.thread.id, documentId: left.documentId, versionId: left.versionId },
      to: { threadId: toThreadId, documentId: joined.documentId, versionId: joined.versionId },
      followsEnded: ended.length,
    }
  } finally {
    await sealQuietBatch(session, batchId)
  }
}

function refusedOr(result: ThreadVersionResult): { documentId: string; versionId: string | null } {
  if (result.ok) return result
  if (result.failure === 'name_taken')
    throw threadRefusal(
      'name_taken',
      'A document of this name is already in the project; choose another name'
    )
  throw threadRefusal('upload_refused', 'The upload of the thread’s next version was refused', {
    failure: result.failure,
  })
}

function recordDetach(
  session: AuthorizedSession,
  detach: {
    projectId: string
    entryId: string
    fromThreadId: string
    toThreadId: string
    created: boolean
    ended: Array<{ id: string; userId: string }>
  }
): void {
  const actor = { userId: session.userId, email: session.email || null }
  recordAuditEventAfterCommit({
    action: 'mail_thread.entry_detached',
    organizationId: session.organizationId,
    actor,
    targetType: 'mail_thread_entry',
    targetId: detach.entryId,
    alsoTargets: [
      { type: 'mail_thread', id: detach.fromThreadId },
      { type: 'project', id: detach.projectId },
    ],
    metadata: {
      projectId: detach.projectId,
      fromThreadId: detach.fromThreadId,
      toThreadId: detach.toThreadId,
      threadAction: detach.created ? 'create' : 'append',
    },
  })
  for (const follow of detach.ended) {
    recordAuditEventAfterCommit({
      action: 'mail_thread.follow_ended',
      organizationId: session.organizationId,
      actor,
      targetType: 'mail_thread',
      targetId: detach.fromThreadId,
      alsoTargets: [{ type: 'project', id: detach.projectId }],
      metadata: {
        projectId: detach.projectId,
        followId: follow.id,
        reason: 'detached',
        followerUserId: follow.userId,
      },
    })
  }
  publishProjectChanged(session.organizationId, detach.projectId)
}
