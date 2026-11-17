import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBudgetStatus } from './service'

export async function unaskedSpendAllowed(
  session: Pick<AuthorizedSession, 'organizationId'> & { userId: string | null },
  projectId: string | null,
): Promise<boolean> {
  try {
    const status = await getBudgetStatus(session.organizationId, session.userId, projectId)
    return !status.blocked
  } catch (error) {
    console.warn('[budgets] the budget could not be read; not spending on unasked work', error)
    return false
  }
}
