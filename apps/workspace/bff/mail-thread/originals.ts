import 'server-only'

import { createHash } from 'node:crypto'
import { captureServer } from '@/lib/analytics/posthog-server'
import { NotFoundError } from '@/lib/api/errors'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import type { MailThreadEntryRow } from '@/lib/db/schema/mail-thread'
import { requireInboundMailEnabled } from '@/lib/inbound-mail/access'
import { refusal } from '@/lib/inbound-mail/decision'
import { mailOriginalStorageKey } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { scanForStorage } from '@/lib/inbound-mail/malware-scan'
import { heldBytesHeaders } from '@/lib/inbound-mail/service'
import {
  eraseStagedObjects,
  putStagedObject,
  RAW_MESSAGE_CONTENT_TYPE,
  readStagedObject,
} from '@/lib/inbound-mail/staging'
import { findVisibleThread } from './repository'
import { findEntry, forgetMovedRaw, recordEntryOriginal } from './write-repository'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

function originalScanOf(
  mail: Pick<InboundMailRow, 'rawScanStatus' | 'rawScannedAt'>
): Pick<MailThreadEntryRow, 'originalScanStatus' | 'originalScannedAt'> {
  return {
    originalScanStatus: mail.rawScanStatus,
    originalScannedAt: mail.rawScanStatus === 'pending' ? null : mail.rawScannedAt,
  }
}

export async function finishOriginalMove(
  mail: Pick<
    InboundMailRow,
    | 'id'
    | 'organizationId'
    | 'projectId'
    | 'stagingBucket'
    | 'rawStorageKey'
    | 'rawScanStatus'
    | 'rawScannedAt'
  >,
  entry: Pick<MailThreadEntryRow, 'id' | 'originalStorageKey'>
): Promise<'moved' | 'already'> {
  if (!mail.rawStorageKey) return 'already'
  if (!entry.originalStorageKey) {
    const bytes = await readStagedObject(mail.stagingBucket, mail.rawStorageKey)
    const digest = sha256(bytes)
    const key = mailOriginalStorageKey(mail, entry.id)
    await putStagedObject(mail.stagingBucket, key, bytes, RAW_MESSAGE_CONTENT_TYPE)
    const copy = await readStagedObject(mail.stagingBucket, key)
    if (copy.byteLength !== bytes.byteLength || sha256(copy) !== digest) {
      throw new Error(
        `the original of mail ${mail.id} did not read back as written; the raw message stays`
      )
    }
    await recordEntryOriginal(entry.id, {
      originalBucket: mail.stagingBucket,
      originalStorageKey: key,
      originalSha256: digest,
      originalBytes: bytes.byteLength,
      ...originalScanOf(mail),
    })
  }
  const left = await eraseStagedObjects(mail.stagingBucket, [mail.rawStorageKey])
  if (left.length > 0)
    throw new Error(
      `the staged raw message of mail ${mail.id} could not be erased yet; the next run tries again`
    )
  await forgetMovedRaw(mail.id)
  return 'moved'
}

async function readableEntry(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  entryId: string
): Promise<MailThreadEntryRow> {
  requireInboundMailEnabled(session)
  await requireProjectAccess(session, projectId, 'project:view')
  const thread = await findVisibleThread(
    projectId,
    threadId,
    await getHiddenFolderIds(session, projectId)
  )
  const entry = thread ? await findEntry(projectId, entryId) : null
  if (!entry || entry.threadId !== threadId) throw new NotFoundError('Mail not found')
  return entry
}

export async function readEntryOriginal(
  session: AuthorizedSession,
  projectId: string,
  threadId: string,
  entryId: string
): Promise<Response> {
  const entry = await readableEntry(session, projectId, threadId, entryId)
  if (!entry.originalStorageKey || !entry.originalBucket) {
    throw refusal(
      'gone',
      'This message has no kept original: it was imported from an archive, or is still being filed',
      { entryId }
    )
  }
  const bytes = await readStagedObject(entry.originalBucket, entry.originalStorageKey)
  const scan = await scanForStorage(bytes)
  recordAuditEventAfterCommit({
    action: 'mail_thread.original_read',
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email || null },
    targetType: 'mail_thread_entry',
    targetId: entry.id,
    alsoTargets: [
      { type: 'mail_thread', id: threadId },
      { type: 'project', id: projectId },
    ],
    metadata: { projectId, scan: scan.status },
  })
  captureServer({
    event: 'mail_thread_original_downloaded',
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: { scan: scan.status, sender_trust: entry.senderTrust },
  })
  if (scan.status !== 'clean') {
    throw refusal(
      'original_not_clean',
      scan.status === 'infected'
        ? 'The original contains malware and cannot be downloaded'
        : 'The original could not be scanned; try again',
      { entryId, scan: scan.status }
    )
  }
  return new Response(new Blob([new Uint8Array(bytes)]), {
    status: 200,
    headers: heldBytesHeaders('message/rfc822', `mail-${entry.id}.eml`),
  })
}
