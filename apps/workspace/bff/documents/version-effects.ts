import 'server-only'
import type { Locale } from '@/i18n/config'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { recordAuditEvent } from '@/lib/audit/service'
import { filedInOf } from '@/lib/audit/document-names'
import { publishToUsers } from '@/lib/events/bus'
import { emitInboxItems, resolveInboxItemsFor } from '@/lib/inbox/service'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { folderRestrictsReading } from '@/lib/conversations/restricted-egress'
import { hasPassedScreening } from '@/lib/documents/document-reader'
import { documentDisplayName } from './display-name'
import { announceNewRevision } from './revision-notify'
import { isNamespacedAgentDocument } from './agent-namespace'
import { resolveDocumentFolderPath } from './folder-path'
import { resolveReviewers } from './reviewers'
import { readVersionTextForTask } from './version-content'
import { findPreviousVersion } from './version-repository'
import type { DocumentVersionEffect, DocumentVersionTransition } from './lifecycle-types'
import { agentProvenance, ingestPublishedUpload, purgeSupersededChunks } from './version-ingest'

export interface TransitionInput {
  comment?: string | null
  reviewerUserIds?: readonly string[]
  orderMessage?: string | null
  dueAt?: string | null
  ifMatch?: string | null
  request?: Request
  actingHuman?: boolean
  delegateRevision?: boolean
  locale?: Locale
  selfReview?: boolean
}

interface EffectContext {
  session: AuthorizedSession
  document: Document
  version: DocumentVersion
  previous: DocumentVersion | null
  transition: DocumentVersionTransition
  input: TransitionInput
}

type EffectRunner = (context: EffectContext) => Promise<void>

export function reviewGroupKey(documentId: string, versionId: string): string {
  return inboxGroupKey('document.review_requested', 'document', documentId, versionId)
}

function normaliseOrderMessage(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function normaliseDueAt(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function reviewExcerpt(orderMessage: string | null, dueAtIso: string | null): string | null {
  if (!orderMessage) return null
  if (!dueAtIso) return orderMessage
  return `${orderMessage} — Frist: ${dueAtIso.slice(0, 10)}`
}

async function findPreviousVersionId(
  documentId: string,
  organizationId: string,
  versionNumber: number,
): Promise<string | null> {
  try {
    const previous = await findPreviousVersion(documentId, organizationId, versionNumber)
    return previous?.id ?? null
  } catch {
    return null
  }
}

const EFFECT_REGISTRY: Record<DocumentVersionEffect, EffectRunner> = {
  audit: async ({ session, document, version, transition, input }) => {
    await recordAuditEvent({
      organizationId: session.organizationId,
      actor: { userId: session.userId, email: session.email },
      action: transition.auditAction,
      targetType: 'document',
      targetId: document.id,
      filedIn: filedInOf(document),
      metadata: {
        versionId: version.id,
        versionNumber: version.versionNumber,
        state: version.state,
        projectId: document.projectId ?? '',
        withComment: Boolean(input.comment?.trim()),
        selfReview: input.selfReview === true,
        orderMessage: input.orderMessage?.trim() || null,
        dueAt: normaliseDueAt(input.dueAt),
      },
      request: input.request,
    })
  },

  openReviewInbox: async (context) => {
    const { reviewers } = await resolveReviewers(
      context.session,
      context.document,
      context.input.reviewerUserIds,
    )
    const orderMessage = normaliseOrderMessage(context.input.orderMessage)
    const dueAt = normaliseDueAt(context.input.dueAt)
    const previousVersionId = await findPreviousVersionId(
      context.document.id,
      context.session.organizationId,
      context.version.versionNumber,
    )
    await emitInboxItems(
      reviewers.map((recipientUserId) => ({
        organizationId: context.session.organizationId,
        recipientUserId,
        type: 'document.review_requested' as const,
        resourceType: 'document' as const,
        resourceId: context.document.id,
        anchorId: context.version.id,
        actorUserId: context.session.userId,
        groupKey: reviewGroupKey(context.document.id, context.version.id),
        payload: {
          versionId: context.version.id,
          versionNumber: context.version.versionNumber,
          subject: documentDisplayName(context.document),
          orderMessage,
          dueAt,
          previousVersionId,
          excerpt: reviewExcerpt(orderMessage, dueAt),
        },
      })),
    )
  },

  resolveReviewInbox: async (context) => {
    const { reviewers } = await resolveReviewers(
      context.session,
      context.document,
      context.input.reviewerUserIds,
    )
    const groupKey = reviewGroupKey(context.document.id, context.version.id)
    await resolveInboxItemsFor(
      [...new Set([...reviewers, context.session.userId])].map((recipientUserId) => ({
        organizationId: context.session.organizationId,
        recipientUserId,
        groupKey,
      })),
    )
  },

  eventHint: async ({ session, document, version }) => {
    const audience = [session.userId, version.createdBy, version.submittedBy].filter(
      (userId): userId is string => Boolean(userId),
    )
    await publishToUsers([...new Set(audience)], {
      kind: 'document.version.changed',
      documentId: document.id,
      versionId: version.id,
      state: version.state,
    })
  },

  ingestPublished: async ({ session, document, version, previous }) => {
    if (document.authoredBy === 'user') {
      await ingestPublishedUpload(session, document, version)
      return
    }

    if (!isNamespacedAgentDocument(document)) {
      console.warn(
        `[documents] published version ${version.id} is not an agent document that may be indexed; not indexed`,
      )
      return
    }

    const { dispatchDocument, AgentAuthoredDocumentNotIndexableError } = await import('./document-dispatch')

    if (previous) {
      await purgeSupersededChunks(document)
    }

    try {
      await dispatchDocument({
        organizationId: session.organizationId,
        projectId: document.projectId,
        documentId: document.id,
        filename: document.filename,
        storageKey: version.storageKey,
        storageBucket: version.storageBucket,
        collectionName: document.collectionName,
        folderPath: await resolveDocumentFolderPath(document, session.organizationId),
        versionId: version.id,
        provenance: await agentProvenance(session.organizationId, document, version),
      })
    } catch (error) {
      if (!(error instanceof AgentAuthoredDocumentNotIndexableError)) throw error
      console.warn(`[documents] ingest refused the published version ${version.id}`)
    }
  },

  announceNewRevision: async ({ session, document, version, previous }) => {
    if (!previous) return
    void announceNewRevision({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      newerId: document.id,
      olderId: document.id,
      versionId: version.id,
      previousUploaderIds: [previous.createdBy],
    })
  },

  openRevisionTask: async ({ session, document, version, input }) => {
    const delegated = input.delegateRevision === true
    if (version.originConversationId && !delegated) return
    if (!document.projectId) return
    if (!hasPassedScreening(document)) {
      console.warn(`[documents] no revision task for version ${version.id}: its document has not passed screening`)
      return
    }

    try {
      if (await folderRestrictsReading(session.organizationId, document.projectId, document.folderId)) {
        console.warn(`[documents] no revision task for version ${version.id}: its folder restricts reading`)
        return
      }
      const { delegateTask } = await import('@/lib/tasks/delegation')
      const source = await readVersionTextForTask(session, document.id, version.id).catch(() => null)
      await delegateTask(session, {
        projectId: document.projectId,
        kind: 'revision',
        goal: input.comment?.trim() ?? '',
        subject: {
          documentId: document.id,
          versionId: version.id,
          comment: input.comment?.trim() ?? '',
        },
        sourceText: source,
        conversationId: version.originConversationId ?? null,
        requester: { userId: version.createdBy, email: null },
      })
    } catch (error) {
      console.error(
        `[documents] could not open a revision task for version ${version.id}`,
        error,
      )
    }
  },
}

export async function runEffects(context: EffectContext): Promise<void> {
  for (const effect of context.transition.effects) {
    await EFFECT_REGISTRY[effect](context)
  }
}
