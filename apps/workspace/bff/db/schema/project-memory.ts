import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { projects } from './projects'
import {
  PROJECT_MEMORY_CONFIDENCES,
  PROJECT_MEMORY_KINDS,
  PROJECT_MEMORY_STATUSES,
  PROJECT_MEMORY_VERIFICATIONS,
  type ProjectMemoryConfidence,
  type ProjectMemoryKind,
  type ProjectMemoryStatus,
  type ProjectMemoryVerification,
} from '@/lib/projects/memory-vocabulary'

export { PROJECT_MEMORY_KINDS, type ProjectMemoryKind }

export { PROJECT_MEMORY_STATUSES, type ProjectMemoryStatus }

export { PROJECT_MEMORY_CONFIDENCES, type ProjectMemoryConfidence }

export { PROJECT_MEMORY_VERIFICATIONS, type ProjectMemoryVerification }

export const PROJECT_MEMORY_PROVENANCES = [
  'agent',
  'user',
  'distillation',
  'profile_graduation',
] as const
export type ProjectMemoryProvenance = (typeof PROJECT_MEMORY_PROVENANCES)[number]

export const PROJECT_MEMORY_JUDGE_VERDICTS = ['drawn', 'none', 'failed'] as const
export type ProjectMemoryJudgeVerdict = (typeof PROJECT_MEMORY_JUDGE_VERDICTS)[number]

export const PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS = 20

export const PROJECT_MEMORY_SCOPES = ['project', 'organization'] as const
export type ProjectMemoryScope = (typeof PROJECT_MEMORY_SCOPES)[number]

export const projectMemory = pgTable(
  'project_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').$type<ProjectMemoryScope>().notNull().default('project'),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull(),
    kind: text('kind').$type<ProjectMemoryKind>().notNull(),
    content: text('content').notNull(),
    status: text('status').$type<ProjectMemoryStatus>().notNull().default('active'),
    confidence: text('confidence').$type<ProjectMemoryConfidence>().notNull().default('medium'),
    verification: text('verification')
      .$type<ProjectMemoryVerification>()
      .notNull()
      .default('unverified'),
    provenanceType: text('provenance_type')
      .$type<ProjectMemoryProvenance>()
      .notNull()
      .default('agent'),
    sourceConversationId: text('source_conversation_id'),
    supersedesId: uuid('supersedes_id'),
    conflictsWithId: uuid('conflicts_with_id'),
    restrictedFolderIds: uuid('restricted_folder_ids').array(),
    restrictionJudge: text('restriction_judge').$type<ProjectMemoryJudgeVerdict>(),
    evidence: jsonb('evidence').$type<{ fileName: string; page: string | null }[] | null>(),
    topic: text('topic'),
    salience: real('salience').notNull().default(0.5),
    pinned: boolean('pinned').notNull().default(false),
    createdBy: text('created_by'),
    lastReferencedAt: timestamp('last_referenced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    recallCount: integer('recall_count').notNull().default(0),
    embedding: real('embedding').array(),
    embeddingModel: text('embedding_model'),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
  },
  (table) => ({
    projectIdx: index('idx_project_memory_project_id').on(table.projectId),
    projectStatusIdx: index('idx_project_memory_project_status').on(table.projectId, table.status),
    orgScopeIdx: index('idx_project_memory_org_scope').on(
      table.organizationId,
      table.scope,
      table.status
    ),
    projectTopicIdx: index('idx_project_memory_topic').on(table.organizationId, table.projectId, table.topic),
  })
)

export const projectMemoryRelations = relations(projectMemory, ({ one }) => ({
  project: one(projects, { fields: [projectMemory.projectId], references: [projects.id] }),
  supersedes: one(projectMemory, {
    fields: [projectMemory.supersedesId],
    references: [projectMemory.id],
  }),
}))

export type ProjectMemoryItem = typeof projectMemory.$inferSelect
export type NewProjectMemoryItem = typeof projectMemory.$inferInsert
