import 'server-only'
import { auditLogsEnabled, recordAuditEventOrThrow, SYSTEM_ACTORS } from '@/lib/audit/service'
import type { DocumentQuarantineDecision } from '@/lib/db/schema/document-quarantine-decisions'
import { modernizeDocumentScope } from '@/lib/db/schema/documents'
import {
  deleteSpentQuarantineDecisions,
  listOwedQuarantineDecisions,
  listOwedQuarantineDecisionsBetween,
  markQuarantineDecisionAudited,
} from './repository'

export const QUARANTINE_AUDIT_GRACE_MS = 60_000
export const QUARANTINE_AUDIT_WINDOW_MS = 7 * 24 * 60 * 60_000
export const QUARANTINE_AUDIT_SWEEP_LIMIT = 50
export const QUARANTINE_PRUNE_LIMIT = 500

export const quarantineEventKey = (decisionId: string): string =>
  `document.quarantined:${decisionId}`

export async function auditQuarantineDecision(
  decision: DocumentQuarantineDecision
): Promise<boolean> {
  try {
    await recordAuditEventOrThrow({
      organizationId: decision.organizationId,
      actor: { userId: SYSTEM_ACTORS.uploadScreening, email: null },
      action: 'document.quarantined',
      targetType: 'document',
      targetId: decision.documentId,
      metadata: {
        projectId: decision.projectId ?? '',
        filename: decision.filename.slice(0, 200),
        scope: modernizeDocumentScope(decision.scope),
        reasons: decision.reasons,
        reasonsOmitted: decision.reasonsOmitted,
        checked: decision.checked,
        uploadedBy: decision.uploadedBy,
        jobId: decision.jobId ?? '',
      },
      filedIn: decision.projectId ? { projectId: decision.projectId, folderId: decision.folderId } : null,
      occurredAt: new Date(decision.decidedAt),
      idempotencyKey: quarantineEventKey(decision.id),
    })
    await markQuarantineDecisionAudited(decision.organizationId, decision.id, new Date())
    return true
  } catch (error) {
    console.warn(
      `[quarantine-audit] decision ${decision.id} stays owed; the upload sweep sends it again:`,
      error
    )
    return false
  }
}

export async function auditOwedQuarantines(
  organizationId: string,
  documentIds: readonly string[]
): Promise<void> {
  if (!auditLogsEnabled()) return
  try {
    const owed = await listOwedQuarantineDecisions(organizationId, documentIds)
    await Promise.all(owed.map((decision) => auditQuarantineDecision(decision)))
  } catch (error) {
    console.warn(
      '[quarantine-audit] could not read the owed decisions; the upload sweep sends them:',
      error
    )
  }
}

export async function sweepOwedQuarantines(now: Date = new Date()): Promise<number> {
  if (!auditLogsEnabled()) return 0
  const owed = await listOwedQuarantineDecisionsBetween(
    new Date(now.getTime() - QUARANTINE_AUDIT_WINDOW_MS),
    new Date(now.getTime() - QUARANTINE_AUDIT_GRACE_MS),
    QUARANTINE_AUDIT_SWEEP_LIMIT
  )
  let sent = 0
  for (const decision of owed) {
    if (await auditQuarantineDecision(decision)) sent += 1
  }
  return sent
}

export async function pruneSpentQuarantines(now: Date = new Date()): Promise<number> {
  return deleteSpentQuarantineDecisions(new Date(now.getTime() - QUARANTINE_AUDIT_WINDOW_MS), QUARANTINE_PRUNE_LIMIT)
}
