import type { useTranslations } from '@/i18n'
import { useChatStore } from '../store'

export const discoverBudgetFailureMessage = async (t: ReturnType<typeof useTranslations>): Promise<string | null> => {
  try {
    const activeProjectId = useChatStore.getState().projectId
    const query = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ''
    const res = await fetch(`/api/auth/connection-diagnostics${query}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { budgetExhausted?: boolean; canManageBudgets?: boolean }
    if (!body.budgetExhausted) return null
    return body.canManageBudgets ? t('budgetExhausted.adminMessage') : t('budgetExhausted.memberMessage')
  } catch {
    return null
  }
}
