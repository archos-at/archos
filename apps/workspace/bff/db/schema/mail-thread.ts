import { sql } from 'drizzle-orm'
import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { MalwareScanStatus, SenderTrust } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type {
  MailThreadAttachmentDisposition,
  MailThreadAttachmentNotFiledReason,
  MailThreadCalendarEvent,
  MailThreadEntrySource,
  MailThreadFiledVia,
  MailThreadFollowEndReason,
  MailThreadLocale,
  MailThreadMaskedSpan,
  MailThreadMessageIdState,
  MailThreadParticipant,
  MailThreadQuote,
} from '@/lib/mail-thread/mail-thread-vocabulary'
import { projects } from './projects'

export const mailThreads = pgTable(
  'mail_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    documentId: uuid('document_id'),
    baseSubject: text('base_subject').notNull(),
    threadIndexGuid: uuid('thread_index_guid'),
    participantDomains: text('participant_domains').array().notNull().default(sql`'{}'::text[]`),
    continuesThreadId: uuid('continues_thread_id'),
    entryCount: integer('entry_count').notNull().default(0),
    renderedBytes: integer('rendered_bytes').notNull().default(0),
    lastEntryAt: timestamp('last_entry_at', { withTimezone: true }),
    renderPendingAt: timestamp('render_pending_at', { withTimezone: true }),
    renderLeaseHolder: uuid('render_lease_holder'),
    renderLeaseUntil: timestamp('render_lease_until', { withTimezone: true }),
    locale: text('locale').$type<MailThreadLocale>().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectFk: foreignKey({
      name: 'mail_threads_project_fkey',
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete('cascade'),
    idProjectOrgKey: unique('mail_threads_id_project_org_key').on(table.id, table.projectId, table.organizationId),
    documentKey: uniqueIndex('uniq_mail_threads_document')
      .on(table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
    threadIndexIdx: index('mail_threads_thread_index_idx')
      .on(table.projectId, table.threadIndexGuid)
      .where(sql`${table.threadIndexGuid} IS NOT NULL`),
    baseSubjectIdx: index('mail_threads_base_subject_idx').on(table.projectId, table.baseSubject),
    withoutDocumentIdx: index('mail_threads_without_document_idx')
      .on(table.createdAt)
      .where(sql`${table.documentId} IS NULL`),
    renderPendingIdx: index('mail_threads_render_pending_idx')
      .on(table.renderPendingAt)
      .where(sql`${table.renderPendingAt} IS NOT NULL`),
  }),
)

export const mailThreadFollows = pgTable(
  'mail_thread_follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    threadId: uuid('thread_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    renewedAt: timestamp('renewed_at', { withTimezone: true }),
    dailyCap: smallint('daily_cap').notNull().default(20),
    expiringNotifiedAt: timestamp('expiring_notified_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: text('ended_by'),
    endedReason: text('ended_reason').$type<MailThreadFollowEndReason>(),
  },
  (table) => ({
    threadFk: foreignKey({
      name: 'mail_thread_follows_thread_fkey',
      columns: [table.threadId, table.projectId, table.organizationId],
      foreignColumns: [mailThreads.id, mailThreads.projectId, mailThreads.organizationId],
    }).onDelete('cascade'),
    decisionKey: unique('mail_thread_follows_decision_key').on(
      table.id,
      table.threadId,
      table.userId,
      table.organizationId,
    ),
    activeKey: uniqueIndex('uniq_mail_thread_follows_active')
      .on(table.threadId, table.userId)
      .where(sql`${table.endedAt} IS NULL`),
    expiryIdx: index('mail_thread_follows_expiry_idx').on(table.expiresAt).where(sql`${table.endedAt} IS NULL`),
  }),
)

export const mailThreadEntries = pgTable(
  'mail_thread_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    threadId: uuid('thread_id').notNull(),
    source: text('source').$type<MailThreadEntrySource>().notNull(),
    inboundMailId: uuid('inbound_mail_id'),
    mailImportId: uuid('mail_import_id'),
    messageId: text('message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    heading: text('heading').notNull(),
    inReplyToEntryId: uuid('in_reply_to_entry_id'),
    senderAddress: text('sender_address'),
    senderName: text('sender_name'),
    senderDomain: text('sender_domain'),
    signerDomain: text('signer_domain'),
    senderTrust: text('sender_trust').$type<SenderTrust>().notNull(),
    authenticationResults: text('authentication_results'),
    authorAddress: text('author_address'),
    authorName: text('author_name'),
    authorSentAt: timestamp('author_sent_at', { withTimezone: true }),
    authorMessageId: text('author_message_id'),
    baseSubject: text('base_subject'),
    threadIndexGuid: uuid('thread_index_guid'),
    participants: jsonb('participants').$type<MailThreadParticipant[]>().notNull().default([]),
    ownText: text('own_text').notNull().default(''),
    maskedSpans: jsonb('masked_spans').$type<MailThreadMaskedSpan[]>(),
    quoted: jsonb('quoted').$type<MailThreadQuote[]>().notNull().default([]),
    calendar: jsonb('calendar').$type<MailThreadCalendarEvent[]>().notNull().default([]),
    firstVersionId: uuid('first_version_id'),
    filedBy: text('filed_by').notNull(),
    filedVia: text('filed_via').$type<MailThreadFiledVia>().notNull(),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
    originalBucket: text('original_bucket'),
    originalStorageKey: text('original_storage_key'),
    originalSha256: text('original_sha256'),
    originalBytes: bigint('original_bytes', { mode: 'number' }),
    originalScanStatus: text('original_scan_status').$type<MalwareScanStatus>(),
    originalScannedAt: timestamp('original_scanned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadFk: foreignKey({
      name: 'mail_thread_entries_thread_fkey',
      columns: [table.threadId, table.projectId, table.organizationId],
      foreignColumns: [mailThreads.id, mailThreads.projectId, mailThreads.organizationId],
    }).onDelete('cascade'),
    idProjectOrgKey: unique('mail_thread_entries_id_project_org_key').on(
      table.id,
      table.projectId,
      table.organizationId,
    ),
    idThreadKey: unique('mail_thread_entries_id_thread_key').on(table.id, table.threadId),
    headingKey: unique('mail_thread_entries_heading_key').on(table.threadId, table.heading),
    messageIdIdx: index('mail_thread_entries_message_id_idx')
      .on(table.projectId, table.messageId)
      .where(sql`${table.messageId} IS NOT NULL`),
    authorMessageIdIdx: index('mail_thread_entries_author_message_id_idx')
      .on(table.projectId, table.authorMessageId)
      .where(sql`${table.authorMessageId} IS NOT NULL`),
    threadSentIdx: index('mail_thread_entries_thread_sent_idx').on(table.threadId, table.sentAt),
    inboundMailIdx: index('mail_thread_entries_inbound_mail_idx')
      .on(table.inboundMailId)
      .where(sql`${table.inboundMailId} IS NOT NULL`),
    mailImportIdx: index('mail_thread_entries_mail_import_idx')
      .on(table.mailImportId)
      .where(sql`${table.mailImportId} IS NOT NULL`),
  }),
)

export const mailThreadEntryAttachments = pgTable(
  'mail_thread_entry_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    position: integer('position').notNull(),
    filename: text('filename'),
    disposition: text('disposition').$type<MailThreadAttachmentDisposition>().notNull(),
    notFiledReason: text('not_filed_reason').$type<MailThreadAttachmentNotFiledReason>(),
    documentId: uuid('document_id'),
    documentVersionId: uuid('document_version_id'),
    sectionName: text('section_name'),
    sectionFolderPath: text('section_folder_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entryFk: foreignKey({
      name: 'mail_thread_entry_attachments_entry_fkey',
      columns: [table.entryId, table.projectId, table.organizationId],
      foreignColumns: [mailThreadEntries.id, mailThreadEntries.projectId, mailThreadEntries.organizationId],
    }).onDelete('cascade'),
    entryPositionKey: unique('mail_thread_entry_attachments_entry_position_key').on(table.entryId, table.position),
    documentIdx: index('mail_thread_entry_attachments_document_idx')
      .on(table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
    versionIdx: index('mail_thread_entry_attachments_version_idx')
      .on(table.documentVersionId)
      .where(sql`${table.documentVersionId} IS NOT NULL`),
  }),
)

export const mailThreadMessageIds = pgTable(
  'mail_thread_message_ids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    threadId: uuid('thread_id').notNull(),
    messageId: text('message_id').notNull(),
    state: text('state').$type<MailThreadMessageIdState>().notNull(),
    entryId: uuid('entry_id'),
  },
  (table) => ({
    threadFk: foreignKey({
      name: 'mail_thread_message_ids_thread_fkey',
      columns: [table.threadId, table.projectId, table.organizationId],
      foreignColumns: [mailThreads.id, mailThreads.projectId, mailThreads.organizationId],
    }).onDelete('cascade'),
    key: unique('mail_thread_message_ids_key')
      .on(table.threadId, table.messageId, table.state, table.entryId)
      .nullsNotDistinct(),
    lookupIdx: index('mail_thread_message_ids_lookup_idx').on(table.projectId, table.messageId),
  }),
)

export type MailThreadRow = typeof mailThreads.$inferSelect
export type NewMailThreadRow = typeof mailThreads.$inferInsert
export type MailThreadFollowRow = typeof mailThreadFollows.$inferSelect
export type NewMailThreadFollowRow = typeof mailThreadFollows.$inferInsert
export type MailThreadEntryRow = typeof mailThreadEntries.$inferSelect
export type NewMailThreadEntryRow = typeof mailThreadEntries.$inferInsert
export type MailThreadMessageIdRow = typeof mailThreadMessageIds.$inferSelect
export type MailThreadEntryAttachmentRow = typeof mailThreadEntryAttachments.$inferSelect
export type NewMailThreadEntryAttachmentRow = typeof mailThreadEntryAttachments.$inferInsert
