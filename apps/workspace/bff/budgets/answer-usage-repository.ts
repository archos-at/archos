import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { llmUsageEvents } from '@/lib/db/schema/budgets'

export interface AnswerUsageRow {
  calls: number
  credits: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  totalTokens: number
}

export async function sumAnswerUsage(
  organizationId: string,
  conversationId: string,
  messageId: string,
): Promise<AnswerUsageRow | null> {
  const db = getDb()
  const [row] = await db
    .select({
      calls: sql<string>`count(*)`,
      credits: sql<string>`coalesce(sum(${llmUsageEvents.credits}), 0)`,
      promptTokens: sql<string>`coalesce(sum(${llmUsageEvents.promptTokens}), 0)`,
      completionTokens: sql<string>`coalesce(sum(${llmUsageEvents.completionTokens}), 0)`,
      reasoningTokens: sql<string>`coalesce(sum(${llmUsageEvents.reasoningTokens}), 0)`,
      totalTokens: sql<string>`coalesce(sum(${llmUsageEvents.totalTokens}), 0)`,
    })
    .from(llmUsageEvents)
    .where(
      and(
        eq(llmUsageEvents.organizationId, organizationId),
        eq(llmUsageEvents.conversationId, conversationId),
        eq(llmUsageEvents.messageId, messageId),
      ),
    )
  const calls = Number.parseInt(String(row?.calls ?? '0'), 10) || 0
  if (calls === 0) return null
  const asNumber = (value: unknown): number => Number.parseFloat(String(value ?? '0')) || 0
  return {
    calls,
    credits: asNumber(row?.credits),
    promptTokens: asNumber(row?.promptTokens),
    completionTokens: asNumber(row?.completionTokens),
    reasoningTokens: asNumber(row?.reasoningTokens),
    totalTokens: asNumber(row?.totalTokens),
  }
}
