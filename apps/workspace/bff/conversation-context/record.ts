import 'server-only'
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { answerContexts } from '@/lib/db/schema/answer-contexts'
import type { ConversationDecision } from './wire'

export async function recordDecidedAnswer(
  decision: ConversationDecision,
  projectId: string | null,
  executor: DbExecutor = getDb(),
): Promise<boolean> {
  if (!decision.answerMessageId || !decision.conversationId) return false
  const decided = {
    conversationId: decision.conversationId,
    userId: decision.userId,
    kind: decision.kind,
    audienceVersion: decision.audienceVersion,
    solo: decision.solo,
    projectId,
    shelves: decision.may.shelves.map((entry) => entry.collection),
    otherProjects: decision.may.otherProjects.reach,
    workspaceRead: decision.may.workspaceRead,
    personalMemory: decision.may.personalMemory,
    personalShelf: decision.may.personalShelf,
    updatedAt: new Date(),
  }
  const written = await executor
    .insert(answerContexts)
    .values({ organizationId: decision.organizationId, messageId: decision.answerMessageId, ...decided })
    .onConflictDoUpdate({
      target: [answerContexts.organizationId, answerContexts.messageId],
      set: decided,
      setWhere: eq(answerContexts.conversationId, decision.conversationId),
    })
    .returning({ messageId: answerContexts.messageId })
  return written.length > 0
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
  conversationId: string,
  answerMessageId: string,
  reads: AnswerReads,
): Promise<boolean> {
  const folders = reads.folders ?? []
  const projects = reads.projects ?? []
  if (folders.length === 0 && projects.length === 0 && !reads.personalShelf) return true
  const written = await executor
    .update(answerContexts)
    .set({
      readFolders: merged(answerContexts.readFolders, folders),
      readProjects: merged(answerContexts.readProjects, projects),
      ...(reads.personalShelf ? { readPersonalShelf: true } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(answerContexts.organizationId, organizationId),
        eq(answerContexts.conversationId, conversationId),
        eq(answerContexts.messageId, answerMessageId),
      ),
    )
    .returning({ messageId: answerContexts.messageId })
  return written.length > 0
}
