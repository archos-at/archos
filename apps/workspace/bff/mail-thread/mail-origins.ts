import 'server-only'

import type { AuthorizedSession } from '@/lib/auth/types'
import { isInboundMailEnabled } from '@/lib/authz/feature-flags'
import { getHiddenFolderIds } from '@/lib/authz/folder-access'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'
import { clampSentAt } from './mail-threading'
import type { DocumentMailOriginView } from './mail-thread-wire'
import { findMailOrigins, type MailOriginRow } from './repository'

const authorLabel = (row: Pick<MailOriginRow, 'authorName' | 'authorAddress'>): string | null =>
  row.authorName?.trim() || (row.authorAddress?.includes('@') ? row.authorAddress.slice(row.authorAddress.lastIndexOf('@') + 1) : null)

export function mailOriginView(row: MailOriginRow): MailOriginView {
  const forwarded = row.authorName !== null || row.authorAddress !== null
  return {
    threadId: row.threadId,
    entryId: row.entryId,
    sentAt: clampSentAt(row.sentAt, row.receivedAt).sentAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    fromName: forwarded ? authorLabel(row) : row.senderName,
    forwardedByName: forwarded ? row.senderName : null,
    forwarded,
    signerDomain: row.signerDomain,
    senderTrust: row.senderTrust,
  }
}

export async function documentMailOrigins(
  session: AuthorizedSession,
  document: { id: string; projectId: string | null }
): Promise<DocumentMailOriginView[]> {
  if (!document.projectId || !isInboundMailEnabled(session)) return []
  const hidden = await getHiddenFolderIds(session, document.projectId)
  const rows = await findMailOrigins(document.projectId, document.id, hidden)
  return rows.map((row) => ({ ...mailOriginView(row), documentVersionId: row.documentVersionId }))
}

export function mailOriginsByVersion(
  origins: readonly DocumentMailOriginView[]
): Map<string, MailOriginView[]> {
  const byVersion = new Map<string, MailOriginView[]>()
  for (const { documentVersionId, ...origin } of origins) {
    if (!documentVersionId) continue
    byVersion.set(documentVersionId, [...(byVersion.get(documentVersionId) ?? []), origin])
  }
  return byVersion
}
