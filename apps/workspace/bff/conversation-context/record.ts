import 'server-only'
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { answerContexts } from '@/lib/db/schema/answer-contexts'
import type { ConversationContext } from './types'

export interface AnswerParty {
  organizationId: string
  userId: string
  conversationId: string
  answerMessageId: string
}

export async function recordAnswerContext(
  party: AnswerParty,
  context: ConversationContext,
  executor: DbExecutor = getDb(),
): Promise<void> {
  const decided = {
    conversationId: party.conversationId,
    userId: party.userId,
    kind: context.kind,
    audienceVersion: context.audience.version,
    solo: context.audience.solo,
    projectId: context.projectId,
    shelves: context.may.shelves.map((entry) => entry.collection),
    otherProjects: context.may.otherProjects.reach,
    workspaceRead: context.may.workspaceRead,
    personalMemory: context.may.personalMemory,
    personalShelf: context.may.personalShelf,
    updatedAt: new Date(),
  }
  await executor
    .insert(answerContexts)
    .values({ organizationId: party.organizationId, messageId: party.answerMessageId, ...decided })
    .onConflictDoUpdate({
      target: [answerContexts.organizationId, answerContexts.messageId],
      set: decided,
      setWhere: eq(answerContexts.conversationId, party.conversationId),
    })
}

export interface AnswerReads {
  folders?: readonly string[]
  projects?: readonly string[]
  personalShelf?: boolean
}

const textArray = (values: readonly string[]) =>
  sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`

const merged = (column: SQLWrapper, added: readonly string[]) =>
  sql`array(select distinct unnest(${column} || ${textArray(added)}) order by 1)`

export async function recordAnswerReads(
  executor: DbExecutor,
  organizationId: string,
  answerMessageId: string,
  reads: AnswerReads,
): Promise<void> {
  const folders = reads.folders ?? []
  const projects = reads.projects ?? []
  if (folders.length === 0 && projects.length === 0 && !reads.personalShelf) return
  await executor
    .update(answerContexts)
    .set({
      readFolders: merged(answerContexts.readFolders, folders),
      readProjects: merged(answerContexts.readProjects, projects),
      ...(reads.personalShelf ? { readPersonalShelf: true } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(answerContexts.organizationId, organizationId), eq(answerContexts.messageId, answerMessageId)))
}
