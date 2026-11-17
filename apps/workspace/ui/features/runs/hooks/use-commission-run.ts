import { useCallback, useState } from 'react'
import { useChatStore } from '@/features/chat/store'
import { useCurrentProject } from '@/features/projects/lib/current-project'
import { commissionRun } from '@/lib/runs/run-view-client'
import type { PlanDocuments } from '@/lib/runs/plan-documents'

export interface CommissionRunHandle {
  commission: (question: string, context?: string, documents?: PlanDocuments) => Promise<boolean>
  pending: boolean
}

export function useCommissionRun(
  projectId: string | null,
  conversationId: string | null
): CommissionRunHandle | null {
  const hydrate = useChatStore((s) => s.hydrateConversationMessages)
  const [pending, setPending] = useState(false)
  const commission = useCallback(
    async (question: string, context?: string, documents?: PlanDocuments): Promise<boolean> => {
      if (!projectId || !conversationId) return false
      setPending(true)
      try {
        await commissionRun(projectId, { conversationId, question, context, documents })
        await hydrate(conversationId)
        return true
      } catch {
        return false
      } finally {
        setPending(false)
      }
    },
    [projectId, conversationId, hydrate]
  )
  const project = useCurrentProject()
  if (!projectId || !conversationId) return null
  if (project?.id === projectId && project.status === 'closed') return null
  return { commission, pending }
}
