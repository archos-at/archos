import 'server-only'
import { markParticipants } from '@/lib/annotations/attention'
import { insertRevisionNotice, planRevisionNotice, type RevisionNoticeJob } from '@/lib/revision-notice/queue'
import { documentCheckMaxBatch } from '@/lib/document-check/check'
import { queueDocumentCheck } from '@/lib/document-check/queue'
import { listDocumentAnnotations, type AnnotationRecord } from '@/lib/annotations/repository'
import { listAssignmentsForResources } from '@/lib/assignments/repository'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import type { Document } from '@/lib/db/schema/documents'
import { DEFAULT_UPLOAD_BATCH_EFFECTS, type UploadBatchRevisionNotice } from '@/lib/db/schema/upload-batches'
import { findBatchSettleEffects, type BatchSettleEffects } from '@/lib/upload-batches/repository'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { recipientsHoldingGroup } from '@/lib/inbox/repository'
import { emitInboxItems } from '@/lib/inbox/service'
import { collectionFileRef } from './collection-file-ref'
import { SCREENED_ONLY } from './document-reader'
import { documentDisplayName, splitDocumentName, type NamedDocument } from './display-name'
import { claimRevisionAnnouncement, releaseRevisionAnnouncement, type RevisionAnnouncementKey } from './revision-announcement-repository'
import type { RevisionLinkNames } from './revision-links'
import { mayOpenDocument } from './may-open'
import { documentNameKey } from './name-match'
import { readRevisionLinkNames, refreshCollectionFiles } from './reconcile-status'
import { findDocumentInOrg, findRevisionCounterparts } from './repository'
import { findPreviousVersion, findPublishedVersion } from './version-repository'

const SUMMARY_LINE_MAX = 200

const SETTLE_LOOKUP_LIMIT = 50

export interface NewRevisionAnnouncement {
  organizationId: string
  actorUserId: string | null
  newerId: string
  olderId: string
  versionId?: string | null
  previousUploaderIds?: readonly (string | null | undefined)[]
  changeSummary?: string | null
  audience?: UploadBatchRevisionNotice
}

export function firstSummaryLine(summary: string | null | undefined): string | null {
  for (const raw of (summary ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/, '').trim()
    if (line) return line.length > SUMMARY_LINE_MAX ? `${line.slice(0, SUMMARY_LINE_MAX - 1).trimEnd()}…` : line
  }
  return null
}

function nameWithoutExtension(document: NamedDocument): string {
  const name = documentDisplayName(document)
  const { extension } = splitDocumentName(document.filename)
  if (extension === '' || !name.toLowerCase().endsWith(extension.toLowerCase())) return name
  const stem = name.slice(0, -extension.length).trimEnd()
  return stem === '' ? name : stem
}

export function revisionRowNames(follow: NamedDocument, newer: NamedDocument | null): { subject: string; related?: string } {
  if (!newer) return { subject: nameWithoutExtension(follow) }
  const subject = nameWithoutExtension(follow)
  const related = nameWithoutExtension(newer)
  if (subject.toLowerCase() === related.toLowerCase()) {
    return { subject: documentDisplayName(follow), related: documentDisplayName(newer) }
  }
  return { subject, related }
}

export function revisionRecipients(input: {
  assigneeIds: readonly string[]
  uploaderIds: readonly (string | null | undefined)[]
  participantIds?: readonly string[]
  actorUserId: string | null
  audience?: UploadBatchRevisionNotice
}): string[] {
  const followers = input.audience === 'marks_only' ? [] : [...input.assigneeIds, ...input.uploaderIds]
  const everyone = [...followers, ...(input.participantIds ?? [])]
  return [...new Set(everyone.filter((id): id is string => Boolean(id) && id !== input.actorUserId))]
}

export function openMarksFacts(
  marks: ReadonlyArray<Pick<AnnotationRecord, 'revisionNumber'>>,
  { sameDocument }: { sameDocument: boolean }
): { variant: string; openMarks: number; marksRevision: number | null } | null {
  if (marks.length === 0) return null
  const numbers = new Set(marks.map((mark) => mark.revisionNumber))
  const [only] = [...numbers]
  const marksRevision = sameDocument && numbers.size === 1 && typeof only === 'number' ? only : null
  const variant = `${marks.length === 1 ? 'mark' : 'marks'}${marksRevision === null ? '_earlier' : ''}`
  return { variant, openMarks: marks.length, marksRevision }
}

async function marksLeftBehind(
  organizationId: string,
  follow: Document,
  versionId: string | null | undefined
): Promise<AnnotationRecord[]> {
  if (follow.scope !== 'project' && follow.scope !== 'office_shelf') return []
  const marks = await listDocumentAnnotations(organizationId, follow.id)
  return marks.filter((mark) => mark.status === 'open' && (!versionId || (mark.versionId ?? null) !== versionId))
}

export async function notifyNewRevision(announcement: NewRevisionAnnouncement): Promise<number> {
  const { organizationId, newerId, olderId } = announcement
  const sameDocument = newerId === olderId
  const [newer, older] = await Promise.all([
    findDocumentInOrg(newerId, organizationId, SCREENED_ONLY),
    sameDocument ? null : findDocumentInOrg(olderId, organizationId, SCREENED_ONLY),
  ])
  const follow = sameDocument ? newer : older
  if (!newer || !follow) return 0
  if (newer.lifecycle !== 'active' || newer.scope === 'session' || follow.scope === 'session') return 0

  const claim = { organizationId, documentId: newer.id, anchorId: announcement.versionId ?? follow.id }
  const notice = sameDocument
    ? null
    : await planRevisionNotice({ organizationId, actorUserId: announcement.actorUserId, newerId: newer.id, olderId: follow.id })
  if (!(await claimWithNotice(claim, notice))) return 0
  try {
    return await writeRevisionItems(announcement, newer, follow, claim.anchorId)
  } catch (error) {
    await releaseRevisionAnnouncement(claim).catch(() => undefined)
    throw error
  }
}

function claimWithNotice(claim: RevisionAnnouncementKey, notice: RevisionNoticeJob | null): Promise<boolean> {
  return withTenant({ organizationId: claim.organizationId }, () =>
    getDb().transaction(async (tx) => {
      if (!(await claimRevisionAnnouncement(claim, tx))) return false
      if (notice) await insertRevisionNotice(notice, tx)
      return true
    }),
  )
}

async function writeRevisionItems(
  announcement: NewRevisionAnnouncement,
  newer: Document,
  follow: Document,
  anchorId: string,
): Promise<number> {
  const { organizationId } = announcement
  const sameDocument = newer.id === follow.id
  const marksOnly = announcement.audience === 'marks_only'
  const [assignments, marks] = await Promise.all([
    marksOnly ? [] : listAssignmentsForResources(organizationId, 'document', [follow.id]),
    marksLeftBehind(organizationId, follow, sameDocument ? (announcement.versionId ?? newer.publishedVersionId) : null),
  ])
  const candidates = revisionRecipients({
    assigneeIds: assignments.map((row) => row.subjectUserId),
    uploaderIds: [follow.createdBy, ...(announcement.previousUploaderIds ?? [])],
    participantIds: marks.flatMap((mark) => markParticipants(mark)),
    actorUserId: announcement.actorUserId,
    audience: announcement.audience,
  })
  if (candidates.length === 0) return 0

  const mayOpenNewer = await mayOpenDocument({ organizationId }, newer, candidates)
  const mayOpenBoth = sameDocument
    ? mayOpenNewer
    : await mayOpenDocument({ organizationId }, follow, [...mayOpenNewer])
  if (mayOpenBoth.size === 0) return 0

  const groupKey = inboxGroupKey('document.new_revision', 'document', newer.id, anchorId)
  const already = await recipientsHoldingGroup(organizationId, groupKey, [...mayOpenBoth])
  const told = [...mayOpenBoth].filter((userId) => !already.has(userId))
  if (told.length === 0) return 0

  const excerpt = firstSummaryLine(announcement.changeSummary)
  const openMarks = openMarksFacts(marks, { sameDocument })
  await emitInboxItems(
    told.map((recipientUserId) => ({
      organizationId,
      recipientUserId,
      type: 'document.new_revision' as const,
      resourceType: 'document' as const,
      resourceId: newer.id,
      anchorId,
      actorUserId: announcement.actorUserId,
      groupKey,
      payload: {
        ...revisionRowNames(follow, sameDocument ? null : newer),
        ...(excerpt ? { excerpt } : {}),
        ...(openMarks ?? {}),
      },
    })),
  )
  return told.length
}

export function announceNewRevision(announcement: NewRevisionAnnouncement): Promise<void> {
  return notifyNewRevision(announcement).then(
    () => undefined,
    (error: unknown) => {
      console.warn(`[revision-notify] could not announce the new Fassung of ${announcement.olderId}:`, error)
    },
  )
}

function changeAgainstName(change: RevisionLinkNames['change'], olderName: string): string | null {
  if (!change || change.basis === null) return null
  return documentNameKey(change.basis) === documentNameKey(olderName) ? change.text : null
}

async function announceSettledVersion(
  organizationId: string,
  document: Document,
  audience: UploadBatchRevisionNotice,
): Promise<void> {
  const version = await findPublishedVersion(document.id, organizationId)
  if (!version || version.versionNumber < 2) return
  const previous = await findPreviousVersion(document.id, organizationId, version.versionNumber)
  await announceNewRevision({
    organizationId,
    actorUserId: version.createdBy,
    newerId: document.id,
    olderId: document.id,
    versionId: version.id,
    previousUploaderIds: [previous?.createdBy],
    audience,
  })
}

async function announceSettledLinks(
  organizationId: string,
  document: Document,
  audience: UploadBatchRevisionNotice,
): Promise<void> {
  const ref = collectionFileRef(document)
  const names = ref ? await readRevisionLinkNames(ref) : null
  if (!names || names.supersedes.length === 0) return
  const olders = await findRevisionCounterparts(organizationId, document.collectionName, names.supersedes, SCREENED_ONLY)
  for (const older of olders) {
    if (older.id === document.id) continue
    await announceNewRevision({
      organizationId,
      actorUserId: document.createdBy,
      newerId: document.id,
      olderId: older.id,
      changeSummary: changeAgainstName(names.change, older.filename),
      audience,
    })
  }
}

async function queueSettledDocumentCheck(organizationId: string, document: Document): Promise<void> {
  if (document.scope !== 'project' || !document.projectId || document.lifecycle !== 'active') return
  const version = await findPublishedVersion(document.id, organizationId).catch(() => null)
  await queueDocumentCheck({
    organizationId,
    actorUserId: document.createdBy,
    documentId: document.id,
    versionId: version?.id ?? null,
  })
}

export async function announceSettledVersions(organizationId: string, documentIds: readonly string[]): Promise<void> {
  const settled: Document[] = []
  for (const documentId of documentIds.slice(0, SETTLE_LOOKUP_LIMIT)) {
    const document = await findDocumentInOrg(documentId, organizationId, SCREENED_ONLY)
    if (document && document.authoredBy === 'user' && document.scope !== 'session') settled.push(document)
  }
  const collections = new Set(settled.filter((document) => collectionFileRef(document)).map((d) => d.collectionName))
  await Promise.all([...collections].map((collection) => refreshCollectionFiles(collection).catch(() => undefined)))
  const effectsOf = await settleEffectsOf(organizationId, settled)
  const checkBatch = settled.length <= documentCheckMaxBatch()
  for (const document of settled) {
    const effects = effectsOf(document)
    await announceSettledVersion(organizationId, document, effects.revisionNotice)
    await announceSettledLinks(organizationId, document, effects.revisionNotice)
    if (checkBatch && effects.runsDocumentCheck) await queueSettledDocumentCheck(organizationId, document)
  }
}

async function settleEffectsOf(
  organizationId: string,
  documents: readonly Document[]
): Promise<(document: Document) => BatchSettleEffects> {
  const batchIds = new Set(documents.flatMap((document) => (document.uploadBatchId ? [document.uploadBatchId] : [])))
  const byBatch = batchIds.size === 0 ? new Map<string, BatchSettleEffects>() : await findBatchSettleEffects(organizationId, [...batchIds])
  return (document) => (document.uploadBatchId && byBatch.get(document.uploadBatchId)) || DEFAULT_UPLOAD_BATCH_EFFECTS
}
