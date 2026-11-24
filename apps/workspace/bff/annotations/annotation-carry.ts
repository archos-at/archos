import 'server-only'
import { UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { Document } from '@/lib/db/schema/documents'
import { replacingDocumentOf } from './carry'
import {
  AlreadyCarriedError,
  carryAnnotationToDocument,
  updateDocumentAnnotation,
  type AnnotationRecord,
} from './repository'
import { keepMentions } from './mentions'
import type { AnnotationView } from './types'
import { PRODUCT_NAME } from '@/lib/brand'
import { type AnnotationActor, isAssignable, requireWritableDocument } from './annotation-access'
import { announce, markEvent } from './annotation-events'
import { viewOf } from './annotation-views'
import { limitReached, conflict } from './annotation-errors'
import { traceSettled, traceAssigned } from './annotation-notifications'

export async function carryToCurrent(
  session: AuthorizedSession,
  doc: Document,
  existing: AnnotationRecord,
  actor: AnnotationActor
): Promise<{ annotation: AnnotationView }> {
  if (existing.status !== 'open') {
    throw new UnprocessableError('Only an open Anmerkung goes on with the current Fassung.', {
      field: 'carryToCurrent',
      reason: 'not-open',
    })
  }
  const replacing = await replacingDocumentOf(session, doc)
  if (replacing) return carryAcross(session, doc, existing, replacing, actor)
  const current = doc.publishedVersionId ?? null
  if ((existing.versionId ?? null) === current) return { annotation: await viewOf(session, doc, existing.id) }
  const updated = await updateDocumentAnnotation(session.organizationId, doc.id, existing.id, 'open', {
    revision: { from: existing.versionId ?? null, to: current },
  })
  if (!updated) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  markEvent(session, 'annotation_carried', doc.id, { way: 'in_place', by: actor.kind })
  return { annotation: await viewOf(session, doc, existing.id) }
}

async function carryAcross(
  session: AuthorizedSession,
  doc: Document,
  existing: AnnotationRecord,
  replacing: Document,
  actor: AnnotationActor
): Promise<{ annotation: AnnotationView }> {
  const target = await requireWritableDocument(session, replacing.id)
  if (existing.delegatedBy) {
    throw new UnprocessableError('Take the Anmerkung back from ' + PRODUCT_NAME + ' before it goes on with the new Fassung.', {
      field: 'carryToCurrent',
      reason: 'delegated',
    })
  }
  const assignee =
    existing.assigneeUserId && (await isAssignable(session, target, existing.assigneeUserId)) ? existing.assigneeUserId : null
  const mentions = await keepMentions(session, target, existing.body, existing.mentions, { piloti: false })
  const row = await carryAnnotationToDocument({
    organizationId: session.organizationId,
    source: existing,
    target: { documentId: target.id, versionId: target.publishedVersionId ?? null },
    values: { mentions, assigneeUserId: assignee },
    closedBy: session.userId,
  }).catch((error: unknown) => {
    if (error instanceof AlreadyCarriedError) throw conflict()
    return limitReached(error)
  })
  if (!row) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  announce(session, target.id, [row.id], 'created', actor)
  markEvent(session, 'annotation_carried', doc.id, { way: 'across', by: actor.kind })
  traceSettled(session, existing.id, true)
  if (row.assigneeUserId) traceAssigned(session, target, row, null, actor)
  return { annotation: await viewOf(session, target, row.id) }
}
