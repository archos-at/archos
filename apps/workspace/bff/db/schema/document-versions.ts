import { relations, sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  DOCUMENT_SUBMIT_ACTORS,
  DOCUMENT_VERSION_ORIGINS,
  DOCUMENT_VERSION_STATES,
  type DocumentSubmitActor,
  type DocumentVersionOrigin,
  type DocumentVersionState,
} from '@/lib/documents/lifecycle-vocabulary'
import { documents } from './documents'

export { DOCUMENT_VERSION_STATES, type DocumentVersionState }
export { DOCUMENT_SUBMIT_ACTORS, type DocumentSubmitActor }
export { DOCUMENT_VERSION_ORIGINS, type DocumentVersionOrigin }

const STATE_LIST = sql.raw(DOCUMENT_VERSION_STATES.map((state) => `'${state}'`).join(', '))

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id').notNull(),
    projectId: uuid('project_id'),
    versionNumber: integer('version_number').notNull(),
    state: text('state').$type<DocumentVersionState>().notNull().default('draft'),
    origin: text('origin').$type<DocumentVersionOrigin>().notNull().default('draft'),
    storageKey: text('storage_key').notNull(),
    storageBucket: text('storage_bucket'),
    contentType: text('content_type'),
    fileSize: integer('file_size'),
    contentHash: text('content_hash'),
    screenedHash: text('screened_hash'),
    submittedBy: text('submitted_by'),
    submittedByActor: text('submitted_by_actor')
      .$type<DocumentSubmitActor>()
      .notNull()
      .default('human'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    publishedBy: text('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    reviewComment: text('review_comment'),
    createdBy: text('created_by').notNull(),
    originConversationId: text('origin_conversation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    numberPerDocument: unique('document_versions_document_id_version_number_key').on(
      table.documentId,
      table.versionNumber,
    ),
    orgIdx: index('idx_document_versions_organization_id').on(table.organizationId),
    idDocumentKey: unique('document_versions_id_document_id_key').on(table.id, table.documentId),
    idProjectKey: unique('document_versions_id_project_id_key').on(table.id, table.projectId),
    documentProjectFk: foreignKey({
      name: 'document_versions_document_id_project_id_fkey',
      columns: [table.documentId, table.projectId],
      foreignColumns: [documents.id, documents.projectId],
    }).onDelete('cascade'),
    documentFk: foreignKey({
      name: 'document_versions_document_id_fkey',
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
    stateKnown: check('document_versions_state_known', sql`${table.state} IN (${STATE_LIST})`),
    submitActorKnown: check(
      'document_versions_submitted_by_actor_known',
      sql`${table.submittedByActor} IN ('human', 'agent')`
    ),
    reviewComplete: check(
      'document_versions_review_complete',
      sql`(${table.reviewedBy} IS NULL) = (${table.reviewedAt} IS NULL)`
    ),
    originKnown: check('document_versions_origin_known', sql`${table.origin} IN ('upload', 'draft')`),
    publishedIsApproved: check(
      'document_versions_published_is_approved',
      sql`${table.state} <> 'published' OR ${table.origin} = 'upload' OR (${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`
    ),
    refusalHasComment: check(
      'document_versions_refusal_has_comment',
      sql`${table.state} NOT IN ('changes_requested', 'rejected') OR ${table.reviewComment} IS NOT NULL`
    ),
  })
)

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(documents, {
    fields: [documentVersions.documentId],
    references: [documents.id],
  }),
}))

export type DocumentVersion = typeof documentVersions.$inferSelect
export type NewDocumentVersion = typeof documentVersions.$inferInsert

export const DOCUMENT_REVIEW_OUTCOMES = ['requested', 'approved', 'changes_requested', 'rejected'] as const
export type DocumentReviewOutcome = (typeof DOCUMENT_REVIEW_OUTCOMES)[number]

export const documentVersionReviews = pgTable(
  'document_version_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id').notNull(),
    versionId: uuid('version_id').notNull(),
    requestedBy: text('requested_by').notNull(),
    requestedByActor: text('requested_by_actor').$type<DocumentSubmitActor>().notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    reviewerUserIds: text('reviewer_user_ids').array().notNull().default(sql`'{}'`),
    outcome: text('outcome').$type<DocumentReviewOutcome>().notNull().default('requested'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionFk: foreignKey({
      name: 'document_version_reviews_version_fkey',
      columns: [table.versionId, table.documentId],
      foreignColumns: [documentVersions.id, documentVersions.documentId],
    }).onDelete('cascade'),
    documentIdx: index('idx_document_version_reviews_document').on(table.organizationId, table.documentId),
    actorKnown: check('document_version_reviews_actor_known', sql`${table.requestedByActor} IN ('human', 'agent')`),
    outcomeKnown: check(
      'document_version_reviews_outcome_known',
      sql`${table.outcome} IN (${sql.raw(DOCUMENT_REVIEW_OUTCOMES.map((outcome) => `'${outcome}'`).join(', '))})`
    ),
    decisionComplete: check(
      'document_version_reviews_decision_complete',
      sql`(${table.outcome} = 'requested') = (${table.decidedBy} IS NULL AND ${table.decidedAt} IS NULL)`
    ),
    refusalHasComment: check(
      'document_version_reviews_refusal_has_comment',
      sql`${table.outcome} NOT IN ('changes_requested', 'rejected') OR ${table.comment} IS NOT NULL`
    ),
  })
)

export type DocumentVersionReview = typeof documentVersionReviews.$inferSelect
export type NewDocumentVersionReview = typeof documentVersionReviews.$inferInsert
