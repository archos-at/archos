import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { MAX_MENTIONS_PER_MESSAGE } from '@/lib/limits/catalog'
import {
  ANNOTATION_AUTHORS,
  ANNOTATION_KINDS,
  ANNOTATION_SHAPES,
  ANNOTATION_STATUSES,
  AGENT_WAKE_STATUSES,
  AGENT_WAKE_TRIGGERS,
  type AnnotationAuthor,
  type AnnotationKind,
  type AnnotationShape,
  type AnnotationStatus,
  type MarkMention,
  type AgentWakeStatus,
  type AgentWakeTrigger,
} from '@/lib/annotations/types'
import { documentVersions } from './document-versions'
import { documents } from './documents'
import { AGENT_KINDS } from '@/lib/agent-kind'

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

const mentionsBounded = (column: AnyPgColumn) =>
  sql`CASE WHEN jsonb_typeof(${column}) = 'array' THEN jsonb_array_length(${column}) <= ${sql.raw(String(MAX_MENTIONS_PER_MESSAGE))} ELSE false END`

export const documentAnnotations = pgTable(
  'document_annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id').notNull(),
    versionId: uuid('version_id'),
    number: integer('number').notNull(),
    page: integer('page').notNull(),
    shape: text('shape').$type<AnnotationShape>().notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w'),
    h: doublePrecision('h'),
    kind: text('kind').$type<AnnotationKind>().notNull(),
    body: text('body').notNull(),
    mentions: jsonb('mentions').$type<MarkMention[]>().notNull().default([]),
    basis: text('basis'),
    authorKind: text('author_kind').$type<AnnotationAuthor>().notNull(),
    status: text('status').$type<AnnotationStatus>().notNull(),
    assigneeUserId: text('assignee_user_id'),
    dueOn: date('due_on', { mode: 'string' }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedBy: text('accepted_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    delegatedBy: text('delegated_by'),
    delegatedAt: timestamp('delegated_at', { withTimezone: true }),
    carriedFromId: uuid('carried_from_id'),
  },
  (table) => ({
    documentFk: foreignKey({
      name: 'document_annotations_document_fkey',
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    versionFk: foreignKey({
      name: 'document_annotations_version_fkey',
      columns: [table.versionId],
      foreignColumns: [documentVersions.id],
    }).onDelete('set null'),
    carriedFromFk: foreignKey({
      name: 'document_annotations_carried_from_fkey',
      columns: [table.carriedFromId],
      foreignColumns: [table.id],
    }).onDelete('set null'),
    numberUniq: uniqueIndex('uniq_document_annotations_number').on(table.documentId, table.number),
    carriedOnce: uniqueIndex('uniq_document_annotations_carried_from')
      .on(table.carriedFromId)
      .where(sql`${table.carriedFromId} IS NOT NULL`),
    dueIdx: index('idx_document_annotations_due')
      .on(table.dueOn)
      .where(sql`${table.status} = 'open' AND ${table.assigneeUserId} IS NOT NULL AND ${table.dueOn} IS NOT NULL`),
    carriedFromOther: check(
      'document_annotations_carried_from_other',
      sql`${table.carriedFromId} IS NULL OR ${table.carriedFromId} <> ${table.id}`
    ),
    organizationIdx: index('idx_document_annotations_organization_id').on(table.organizationId),
    numberPositive: check('document_annotations_number_positive', sql`${table.number} >= 1`),
    pagePositive: check('document_annotations_page_positive', sql`${table.page} >= 1`),
    shapeKnown: check('document_annotations_shape_known', sql`${table.shape} IN (${list(ANNOTATION_SHAPES)})`),
    pointOnPage: check(
      'document_annotations_point_on_page',
      sql`${table.x} >= 0 AND ${table.x} <= 1 AND ${table.y} >= 0 AND ${table.y} <= 1`
    ),
    regionOnPage: check(
      'document_annotations_region_on_page',
      sql`(${table.shape} = 'point' AND ${table.w} IS NULL AND ${table.h} IS NULL) OR (${table.shape} = 'region' AND ${table.w} > 0 AND ${table.h} > 0 AND ${table.x} + ${table.w} <= 1.000001 AND ${table.y} + ${table.h} <= 1.000001)`
    ),
    kindKnown: check('document_annotations_kind_known', sql`${table.kind} IN (${list(ANNOTATION_KINDS)})`),
    authorKnown: check('document_annotations_author_known', sql`${table.authorKind} IN (${list(ANNOTATION_AUTHORS)})`),
    statusKnown: check('document_annotations_status_known', sql`${table.status} IN (${list(ANNOTATION_STATUSES)})`),
    onlyAgentProposes: check(
      'document_annotations_only_agent_proposes',
      sql`${table.status} <> 'proposed' OR ${table.authorKind} IN (${list(AGENT_KINDS)})`
    ),
    acceptanceComplete: check(
      'document_annotations_acceptance_complete',
      sql`(${table.acceptedBy} IS NULL) = (${table.acceptedAt} IS NULL)`
    ),
    agentNeedsAPerson: check(
      'document_annotations_agent_needs_a_person',
      sql`${table.authorKind} = 'person' OR ${table.status} IN ('proposed', 'dismissed') OR ${table.acceptedBy} IS NOT NULL`
    ),
    closingComplete: check(
      'document_annotations_closing_complete',
      sql`(${table.status} IN ('resolved', 'dismissed')) = (${table.closedBy} IS NOT NULL) AND (${table.closedBy} IS NULL) = (${table.closedAt} IS NULL)`
    ),
    bodyLength: check('document_annotations_body_length', sql`char_length(btrim(${table.body})) BETWEEN 1 AND 2000`),
    basisLength: check(
      'document_annotations_basis_length',
      sql`${table.basis} IS NULL OR char_length(${table.basis}) BETWEEN 1 AND 300`
    ),
    delegationComplete: check(
      'document_annotations_delegation_complete',
      sql`(${table.delegatedBy} IS NULL) = (${table.delegatedAt} IS NULL)`
    ),
    delegatedWhileOpen: check(
      'document_annotations_delegated_while_open',
      sql`${table.delegatedBy} IS NULL OR ${table.status} = 'open'`
    ),
    mentionsBounded: check('document_annotations_mentions_bounded', mentionsBounded(table.mentions)),
  })
)

export type DocumentAnnotationRow = typeof documentAnnotations.$inferSelect
export type NewDocumentAnnotationRow = typeof documentAnnotations.$inferInsert

export const documentAnnotationReplies = pgTable(
  'document_annotation_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    annotationId: uuid('annotation_id').notNull(),
    authorKind: text('author_kind').$type<AnnotationAuthor>().notNull(),
    body: text('body').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    addressesAgent: boolean('addresses_agent').notNull().default(false),
    mentions: jsonb('mentions').$type<MarkMention[]>().notNull().default([]),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => ({
    annotationFk: foreignKey({
      name: 'document_annotation_replies_annotation_fkey',
      columns: [table.annotationId],
      foreignColumns: [documentAnnotations.id],
    }).onDelete('cascade'),
    annotationIdx: index('idx_document_annotation_replies_annotation').on(table.annotationId, table.createdAt),
    organizationIdx: index('idx_document_annotation_replies_organization_id').on(table.organizationId),
    authorKnown: check(
      'document_annotation_replies_author_known',
      sql`${table.authorKind} IN (${list(ANNOTATION_AUTHORS)})`
    ),
    bodyLength: check(
      'document_annotation_replies_body_length',
      sql`char_length(btrim(${table.body})) BETWEEN 1 AND 2000`
    ),
    mentionsBounded: check('document_annotation_replies_mentions_bounded', mentionsBounded(table.mentions)),
    editedAfterCreated: check(
      'document_annotation_replies_edited_after_created',
      sql`${table.editedAt} IS NULL OR ${table.editedAt} >= ${table.createdAt}`
    ),
  })
)

export type DocumentAnnotationReplyRow = typeof documentAnnotationReplies.$inferSelect

export const pilotiWakes = pgTable(
  'agent_wakes',
  {
    id: uuid('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id').notNull(),
    annotationId: uuid('annotation_id').notNull(),
    triggerKind: text('trigger_kind').$type<AgentWakeTrigger>().notNull(),
    eventId: text('event_id').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    status: text('status').$type<AgentWakeStatus>().notNull().default('queued'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => ({
    annotationFk: foreignKey({
      name: 'agent_wakes_annotation_fkey',
      columns: [table.annotationId],
      foreignColumns: [documentAnnotations.id],
    }).onDelete('cascade'),
    annotationIdx: index('idx_agent_wakes_annotation_created').on(table.annotationId, table.createdAt),
    documentIdx: index('idx_agent_wakes_document_annotation_created').on(
      table.documentId,
      table.annotationId,
      table.createdAt.desc()
    ),
    actorIdx: index('idx_agent_wakes_actor_created').on(table.organizationId, table.actorUserId, table.createdAt),
    triggerKnown: check('agent_wakes_trigger_known', sql`${table.triggerKind} IN (${list(AGENT_WAKE_TRIGGERS)})`),
    statusKnown: check('agent_wakes_status_known', sql`${table.status} IN (${list(AGENT_WAKE_STATUSES)})`),
    reasonWhenNotStarted: check(
      'agent_wakes_reason_when_not_started',
      sql`(${table.status} IN ('suppressed', 'refused', 'failed')) = (${table.reason} IS NOT NULL)`
    ),
    reasonLength: check(
      'agent_wakes_reason_length',
      sql`${table.reason} IS NULL OR char_length(${table.reason}) BETWEEN 1 AND 500`
    ),
    settledWhenNotQueued: check(
      'agent_wakes_settled_when_not_queued',
      sql`(${table.status} = 'queued') = (${table.settledAt} IS NULL)`
    ),
    endedWhenFinal: check(
      'agent_wakes_ended_when_final',
      sql`(${table.status} IN ('queued', 'started')) = (${table.endedAt} IS NULL)`
    ),
  })
)

export type AgentWakeRow = typeof pilotiWakes.$inferSelect
