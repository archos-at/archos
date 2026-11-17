import { documentShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import { isFolderVisibleTo } from '@/lib/authz/folder-access'
import { recordAuditEvent } from '@/lib/audit/service'
import { filedInOf } from '@/lib/audit/document-names'
import { publishToUsers } from '@/lib/events/bus'
import { emitInboxItems, openRecipientsOf, resolveInboxItemsFor } from '@/lib/inbox/service'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { getBackendUrl } from '@/lib/backend-proxy'
import { resolvePeople } from '@/lib/sharing/directory'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from './access'
import { readerVersionViews, toDocumentVersionView } from './version-view'

export { toDocumentVersionView } from './version-view'
import {
  AGENT_REFUSAL_LOCALE,
  confinementRefusal,
  folderRestrictsReading,
  requireMayFileFrom,
  type ConversationOrigin,
} from '@/lib/conversations/restricted-egress'
import type { Locale } from '@/i18n/config'
import { findProjectInOrg } from '@/lib/projects/repository'
import { isAgentDocumentFilename } from './agent-namespace'
import { collectionFileRef, purgeIngestedChunks } from './collection-file-ref'
import { documentDisplayName } from './display-name'
import { announceNewRevision } from './revision-notify'
import { findDocumentInOrg } from './repository'
import { hasPassedScreening, internalRead, memberReader } from '@/lib/documents/document-reader'
import { resolveDocumentFolderPath } from './folder-path'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import { DocumentDeletedError, OpenVersionExistsError } from './unique-conflicts'
import { discardObject } from '@/lib/storage/discard'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import {
  BACKEND_PURGE_TIMEOUT_MS,
  readVersionTextForTask,
  renderVersionBytes,
  writeVersionContent,
} from './version-content'
import type { DispatchDocumentResult } from './document-dispatch'
import type { AgentDocumentProvenance, IngestPriority } from './ingest-dispatch'
import {
  DOCUMENT_VERSION_TRANSITIONS,
  findDocumentVersionTransition,
  type DocumentVersionEffect,
  type DocumentVersionOp,
  type DocumentVersionListResponse,
  type DocumentVersionTransition,
  type DocumentVersionView,
  type ReviewQueueQuery,
  type ReviewQueueResponse,
} from './lifecycle-types'
import {
  compareAndSwapVersionState,
  type ReviewRoundWrite,
  findDocumentVersion,
  listDocumentVersionSummaries,
  listReviewQueue,
  findOpenVersion,
  findPreviousVersion,
  findPublishedVersion,
  insertDocumentVersion,
  insertPublishedVersion,
  listDocumentVersions,
  nextVersionNumber,
  promoteVersionToPublished,
  type DocumentVersionSummary,
} from './version-repository'

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

async function ingestPublishedUpload(
  session: AuthorizedSession,
  document: Document,
  version: DocumentVersion,
): Promise<void> {
  if (version.contentHash !== null && version.contentHash === document.screenedHash) return
  const { dispatchDocument } = await import('./document-dispatch')
  await dispatchDocument({
    organizationId: session.organizationId,
    projectId: document.projectId,
    documentId: document.id,
    filename: document.filename,
    storageKey: version.storageKey,
    storageBucket: version.storageBucket,
    collectionName: document.collectionName,
    folderPath: await resolveDocumentFolderPath(document, session.organizationId),
  })
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

function reviewGroupKey(documentId: string, versionId: string): string {
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

    if (!isAgentDocumentFilename(document.filename)) {
      console.warn(
        `[documents] published version ${version.id} is not under the piloti/ namespace; not indexed`,
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

async function purgeSupersededChunks(document: Document): Promise<void> {
  const ref = collectionFileRef(document)
  if (!ref) return
  await purgeIngestedChunks(getBackendUrl(), ref, BACKEND_PURGE_TIMEOUT_MS)
}

async function agentProvenance(
  organizationId: string,
  document: Document,
  version: DocumentVersion,
): Promise<AgentDocumentProvenance> {
  const approver = version.approvedBy
    ? (await resolvePeople(organizationId, [version.approvedBy])).get(version.approvedBy)
    : undefined
  return {
    authored_by: 'agent',
    approved_by: approver?.name ?? null,
    approved_at: version.approvedAt?.toISOString() ?? null,
    producer: document.authoredByProducer,
  }
}

export async function redispatchPublishedVersion(
  organizationId: string,
  document: Document,
  priority: IngestPriority,
): Promise<DispatchDocumentResult> {
  const { dispatchDocument, AgentAuthoredDocumentNotIndexableError } = await import('./document-dispatch')
  const version = await findPublishedVersion(document.id, organizationId)
  if (!version || !isAgentDocumentFilename(document.filename)) {
    throw new AgentAuthoredDocumentNotIndexableError(document.id)
  }
  return dispatchDocument({
    organizationId,
    projectId: document.projectId,
    documentId: document.id,
    filename: document.filename,
    storageKey: version.storageKey,
    storageBucket: version.storageBucket,
    collectionName: document.collectionName,
    folderPath: await resolveDocumentFolderPath(document, organizationId),
    versionId: version.id,
    provenance: await agentProvenance(organizationId, document, version),
    priority,
  })
}

async function runEffects(context: EffectContext): Promise<void> {
  for (const effect of context.transition.effects) {
    await EFFECT_REGISTRY[effect](context)
  }
}

async function requireTransitionPermission(
  session: AuthorizedSession,
  document: Document,
  transition: DocumentVersionTransition,
): Promise<void> {
  if (!document.projectId) return
  await requireProjectAccess(session, document.projectId, transition.permission)
  if (transition.alsoRequires) {
    await requireProjectAccess(session, document.projectId, transition.alsoRequires)
  }
}

function assertGuards(
  session: AuthorizedSession,
  version: DocumentVersion,
  transition: DocumentVersionTransition,
  input: TransitionInput,
): void {
  if (transition.actor === 'human' && input.actingHuman === false) {
    throw new ForbiddenError(`${transition.op} is a person's decision`, { op: transition.op })
  }
  if (transition.requires.comment && !input.comment?.trim()) {
    throw new UnprocessableError('This decision needs a comment', { op: transition.op })
  }
  if (
    transition.requires.ifMatch &&
    version.contentHash !== null &&
    input.ifMatch != null &&
    input.ifMatch !== version.contentHash
  ) {
    throw new ConflictError('The version changed since you read it', {
      op: transition.op,
      contentHash: version.contentHash,
    })
  }
}

async function assertReviewGuards(
  session: AuthorizedSession,
  document: Document,
  version: DocumentVersion,
  transition: DocumentVersionTransition,
  input: TransitionInput,
): Promise<{ reviewers?: readonly string[]; selfReview: boolean }> {
  if (transition.requires.notSubmitter && version.submittedBy === session.userId) {
    if (version.submittedByActor === 'human') {
      const candidates = await listReviewCandidates(session, document)
      if (candidates.length > 0) {
        throw new ForbiddenError('The submitter cannot approve their own version', {
          op: transition.op,
        })
      }
      return { selfReview: true }
    }
  }

  if (!transition.requires.reviewer) return { selfReview: false }
  const resolved = await resolveReviewers(session, document, input.reviewerUserIds)
  return { reviewers: resolved.reviewers, selfReview: resolved.selfReview }
}

function stampFor(
  transition: Pick<DocumentVersionTransition, 'to' | 'op'>,
  session: AuthorizedSession,
  input: TransitionInput,
  now: Date,
): Record<string, unknown> {
  const comment = input.comment?.trim() || null
  const { to } = transition
  if (transition.op === 'approve') {
    return {
      state: to,
      reviewedBy: session.userId,
      reviewedAt: now,
      approvedBy: session.userId,
      approvedAt: now,
      reviewComment: comment,
      ...(to === 'published' ? { publishedBy: session.userId, publishedAt: now } : {}),
    }
  }
  switch (to) {
    case 'in_review':
      return {
        state: to,
        submittedBy: session.userId,
        submittedByActor: input.actingHuman === false ? ('agent' as const) : ('human' as const),
        submittedAt: now,
      }
    case 'changes_requested':
    case 'rejected':
      return { state: to, reviewedBy: session.userId, reviewedAt: now, reviewComment: comment }
    case 'published':
      return { state: to, publishedBy: session.userId, publishedAt: now }
    case 'draft':
      return { state: to, reviewComment: null, reviewedBy: null, reviewedAt: null }
    default:
      return { state: to }
  }
}

function reviewRoundFor(
  op: DocumentVersionOp,
  session: AuthorizedSession,
  input: TransitionInput,
): ReviewRoundWrite | undefined {
  const comment = input.comment?.trim() || null
  switch (op) {
    case 'submit':
      return {
        kind: 'open',
        requestedBy: session.userId,
        requestedByActor: input.actingHuman === false ? 'agent' : 'human',
        reviewerUserIds: input.reviewerUserIds ?? [],
      }
    case 'approve':
      return { kind: 'decide', outcome: 'approved', decidedBy: session.userId, comment }
    case 'request_changes':
      return { kind: 'decide', outcome: 'changes_requested', decidedBy: session.userId, comment }
    case 'reject':
      return { kind: 'decide', outcome: 'rejected', decidedBy: session.userId, comment }
    default:
      return undefined
  }
}

export async function transitionDocumentVersion(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  op: DocumentVersionOp,
  input: TransitionInput = {},
): Promise<DocumentVersion> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version) throw new NotFoundError('Version not found')

  const transition = findDocumentVersionTransition(version.state, op)
  if (!transition) {
    throw new ConflictError(`Cannot ${op} a version that is ${version.state}`, {
      state: version.state,
      op,
    })
  }

  assertGuards(session, version, transition, input)
  await requireTransitionPermission(session, document, transition)
  if (transition.effects.includes('openReviewInbox') && !hasPassedScreening(document)) {
    throw new ConflictError('The document has not passed screening yet', { op, reason: 'held' })
  }
  const review = await assertReviewGuards(session, document, version, transition, input)
  if (input.delegateRevision === true && transition.effects.includes('openRevisionTask')) {
    if (await folderRestrictsReading(session.organizationId, document.projectId, document.folderId)) {
      throw confinementRefusal('revision', input.locale ?? AGENT_REFUSAL_LOCALE)
    }
  }
  const effectInput: TransitionInput = {
    ...input,
    ...(review.reviewers ? { reviewerUserIds: review.reviewers } : {}),
    selfReview: review.selfReview,
  }

  const stamp = stampFor(transition, session, effectInput, new Date())
  const round = reviewRoundFor(transition.op, session, effectInput)
  const promoted = transition.promotes
    ? await promoteVersionToPublished(
        versionId,
        documentId,
        session.organizationId,
        version.state,
        stamp,
        round,
      )
    : null
  const swapped = transition.promotes
    ? (promoted?.version ?? null)
    : await compareAndSwapVersionState(versionId, session.organizationId, version.state, stamp, round)
  if (!swapped) {
    throw new ConflictError('The version changed while you were deciding', { op })
  }
  publishShelfChanged(session.organizationId, documentShelf(document))

  await runEffects({
    session,
    document,
    version: swapped,
    previous: promoted?.superseded[0] ?? null,
    transition,
    input: effectInput,
  })
  return swapped
}

export interface CreateVersionInput {
  document: Document
  op: Extract<DocumentVersionOp, 'upload' | 'create'>
  storageKey: string
  storageBucket: string | null
  contentType: string | null
  fileSize: number | null
  contentHash: string | null
  request?: Request
  actingHuman?: boolean
  originConversationId?: string | null
}

export async function createDocumentVersion(
  session: AuthorizedSession,
  input: CreateVersionInput,
): Promise<DocumentVersion> {
  const transition = findDocumentVersionTransition(null, input.op)
  if (!transition) throw new ConflictError(`No transition creates a version by ${input.op}`)
  if (transition.actor === 'human' && input.actingHuman === false) {
    throw new ForbiddenError(`${input.op} is a person's decision`, { op: input.op })
  }
  await requireTransitionPermission(session, input.document, transition)

  const now = new Date()
  const values = {
    organizationId: session.organizationId,
    documentId: input.document.id,
    projectId: input.document.projectId,
    storageKey: input.storageKey,
    storageBucket: input.storageBucket,
    contentType: input.contentType,
    fileSize: input.fileSize,
    contentHash: input.contentHash,
    createdBy: session.userId,
    originConversationId: input.originConversationId ?? null,
    ...(transition.to === 'published'
      ? { state: 'published' as const, origin: 'upload' as const, publishedBy: session.userId, publishedAt: now }
      : { state: transition.to, origin: 'draft' as const }),
  }

  const promoted = transition.promotes ? await insertPublishedVersion(values) : null
  const version = promoted?.version ?? (await insertDocumentVersion(values))

  await runEffects({
    session,
    document: input.document,
    version,
    previous: promoted?.superseded[0] ?? null,
    transition,
    input: { request: input.request, actingHuman: input.actingHuman },
  })
  return version
}

function openVersionConflict(open: DocumentVersion): ConflictError {
  return new ConflictError('This document already has an open version', {
    versionId: open.id,
    state: open.state,
  })
}

export async function forkDraftVersion(
  session: AuthorizedSession,
  documentId: string,
  request?: Request,
): Promise<DocumentVersion> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  const open = await findOpenVersion(documentId, session.organizationId)
  if (open) throw openVersionConflict(open)
  const published = await findPublishedVersion(documentId, session.organizationId)
  const source = published ?? {
    storageKey: document.storageKey,
    storageBucket: document.storageBucket,
    contentType: document.contentType,
    fileSize: document.fileSize,
    contentHash: document.contentHash,
    screenedHash: null,
  }

  const transition = findDocumentVersionTransition(null, 'create')
  if (!transition) throw new ConflictError('No transition creates a draft')
  await requireTransitionPermission(session, document, transition)

  const version = await insertDocumentVersion({
    organizationId: session.organizationId,
    documentId,
    projectId: document.projectId,
    state: 'draft',
    origin: 'draft',
    storageKey: source.storageKey,
    storageBucket: source.storageBucket,
    contentType: source.contentType,
    fileSize: source.fileSize,
    contentHash: source.contentHash,
    screenedHash: source.screenedHash,
    createdBy: session.userId,
  }).catch(async (error: unknown) => {
    if (!(error instanceof OpenVersionExistsError)) throw error
    const winner = await findOpenVersion(documentId, session.organizationId)
    throw winner ? openVersionConflict(winner) : error
  })

  await runEffects({
    session,
    document,
    version,
    previous: published,
    transition,
    input: { request },
  })
  return version
}

export async function replaceVersionContent(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
  content: string,
  ifMatch: string | null | undefined,
  options: {
    request?: Request
    actingHuman?: boolean
    origin?: ConversationOrigin
  } = {},
): Promise<DocumentVersion> {
  const document = await getAccessibleDocument(session, documentId, 'write')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version) throw new NotFoundError('Version not found')

  const transition = findDocumentVersionTransition(version.state, 'update')
  if (!transition) {
    throw new ConflictError(`Cannot replace the content of a version that is ${version.state}`, {
      state: version.state,
    })
  }
  assertGuards(session, version, transition, { ifMatch, actingHuman: options.actingHuman })
  await requireTransitionPermission(session, document, transition)
  if (options.origin) {
    const project = document.projectId ? await findProjectInOrg(document.projectId, session.organizationId) : null
    await requireMayFileFrom(options.origin, {
      organizationId: session.organizationId,
      projectId: project ? project.id : null,
      projectCollection: project?.collectionName ?? document.collectionName,
      folderId: document.folderId,
    })
  }

  const rendered = await renderVersionBytes(document, version, content)
  const swapped = await writeVersionContent({
    organizationId: session.organizationId,
    document,
    version,
    rendered,
    stamp: stampFor(transition, session, {}, new Date()),
  })

  await runEffects({
    session,
    document,
    version: swapped,
    previous: null,
    transition,
    input: { request: options.request, actingHuman: options.actingHuman },
  })
  return swapped
}

export async function recordUploadedVersion(
  session: AuthorizedSession,
  documentId: string,
  request?: Request,
  stored?: UploadedBytes,
): Promise<DocumentVersion | null> {
  const document = await findDocumentInOrg(documentId, session.organizationId, internalRead('just-written'))
  if (!document) return null
  const bytes = stored ?? document
  try {
    return await createDocumentVersion(session, {
      document,
      op: 'upload',
      storageKey: bytes.storageKey,
      storageBucket: bytes.storageBucket,
      contentType: bytes.contentType,
      fileSize: bytes.fileSize,
      contentHash: bytes.contentHash,
      request,
    })
  } catch (error) {
    if (error instanceof DocumentDeletedError) return null
    throw error
  }
}

type UploadedBytes = Pick<
  DocumentVersion,
  'storageKey' | 'storageBucket' | 'contentType' | 'fileSize' | 'contentHash'
>

export async function recordUploadedVersionOrDiscard(
  session: AuthorizedSession,
  documentId: string,
  request: Request | undefined,
  stored: UploadedBytes,
): Promise<DocumentVersion> {
  const version = await recordUploadedVersion(session, documentId, request, stored)
  if (version) return version
  await discardObject(resolveDocumentBucket(stored.storageBucket), stored.storageKey)
  throw new DocumentDeletedError(documentId)
}

export { nextVersionNumber }

export async function listDocumentVersionViews(
  session: AuthorizedSession,
  documentId: string,
): Promise<DocumentVersionListResponse> {
  const document = await getAccessibleDocument(session, documentId, 'read')
  const rows = await listDocumentVersions(documentId, session.organizationId)
  const versions = await readerVersionViews(session, document, rows)
  const reviewerUserIds = await openReviewRound(session.organizationId, documentId, versions)
  const people = await resolvePeople(session.organizationId, [...new Set([...versionActors(versions), ...reviewerUserIds])])
  return {
    documentId,
    lifecycle: document.lifecycle,
    publishedVersionId: document.publishedVersionId,
    versions,
    reviewerUserIds,
    people: [...people.values()].map((person) => ({ userId: person.userId, name: person.name })),
  }
}

async function openReviewRound(
  organizationId: string,
  documentId: string,
  versions: readonly DocumentVersionView[],
): Promise<string[]> {
  const newest = versions.reduce<DocumentVersionView | null>(
    (best, version) => (best === null || version.versionNumber > best.versionNumber ? version : best),
    null,
  )
  if (newest?.state !== 'in_review') return []
  return openRecipientsOf(organizationId, reviewGroupKey(documentId, newest.id))
}

export async function listReviewQueueViews(
  session: AuthorizedSession,
  query: ReviewQueueQuery,
): Promise<ReviewQueueResponse> {
  if (query.projectId) await requireProjectAccess(session, query.projectId, 'project:view')
  const fetched = await listReviewQueue(session.organizationId, memberReader(session.userId), {
    role: query.role,
    userId: session.userId,
    projectId: query.projectId,
    after: query.cursor,
    limit: query.limit,
  })
  const hasMore = fetched.length > query.limit
  const rows = hasMore ? fetched.slice(0, query.limit) : fetched
  const reachable = new Map<string, Promise<boolean>>()
  const mayRead = (projectId: string) => {
    let known = reachable.get(projectId)
    if (!known) {
      known = requireProjectAccess(session, projectId, 'project:view').then(
        () => true,
        () => false,
      )
      reachable.set(projectId, known)
    }
    return known
  }
  const shown = (
    await Promise.all(
      rows.map(async (row) =>
        !row.projectId ||
        ((await mayRead(row.projectId)) && (await isFolderVisibleTo(session, row.projectId, row.folderId)))
          ? row
          : null,
      ),
    )
  ).filter((row) => row !== null)
  const people = await resolvePeople(
    session.organizationId,
    shown.flatMap((row) => (row.submittedBy ? [row.submittedBy] : [])),
  )
  return {
    versions: shown.map((row) => ({
      documentId: row.documentId,
      documentName: row.documentName,
      projectId: row.projectId,
      projectName: row.projectName,
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      submittedBy: row.submittedBy,
      submittedByName: row.submittedBy ? (people.get(row.submittedBy)?.name ?? null) : null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? (rows.at(-1)?.versionId ?? null) : null,
  }
}

function versionActors(versions: readonly DocumentVersionView[]): string[] {
  return versions.flatMap((version) =>
    [version.createdBy, version.submittedBy, version.reviewedBy, version.approvedBy, version.publishedBy].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  )
}

export async function summarizeDocumentVersions(
  organizationId: string,
  documentIds: readonly string[],
): Promise<Map<string, DocumentVersionSummary>> {
  const summaries = await listDocumentVersionSummaries(documentIds, organizationId)
  return new Map(summaries.map((summary) => [summary.documentId, summary]))
}

export async function getDocumentVersionView(
  session: AuthorizedSession,
  documentId: string,
  versionId: string,
): Promise<DocumentVersionView> {
  await getAccessibleDocument(session, documentId, 'read')
  const version = await findDocumentVersion(versionId, documentId, session.organizationId)
  if (!version) throw new NotFoundError('Version not found')
  return toDocumentVersionView(version)
}

export { DOCUMENT_VERSION_TRANSITIONS }
export type { DocumentVersionSummary }
