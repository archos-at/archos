import 'server-only'
import type { BudgetUnit } from '@/lib/db/schema/budgets'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { sumAnswerUsage, type AnswerUsageRow } from './answer-usage-repository'
import { getOrgBudgetUnit } from './policy-lookup'

export interface AnswerUsage extends AnswerUsageRow {
  unit: BudgetUnit
}

export async function getAnswerUsage(
  session: AuthorizedSession,
  conversationId: string,
  messageId: string,
): Promise<AnswerUsage | null> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  const [row, unit] = await Promise.all([
    sumAnswerUsage(session.organizationId, conversationId, messageId),
    getOrgBudgetUnit(session.organizationId),
  ])
  return row ? { ...row, unit } : null
}
