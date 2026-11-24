import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { executeRows } from '@/lib/db/execute-rows'

export async function personalConversationHidden(conversationId: string, executor: DbExecutor = getDb()): Promise<boolean> {
  const [row] = executeRows<{ hidden: boolean }>(
    await executor.execute(sql`select personal_conversation_hidden(${conversationId}) as hidden`),
  )
  return row?.hidden === true
}
