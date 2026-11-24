import { useMemo } from 'react'
import { toast } from 'sonner'
import { ApiRequestError } from '@/adapters/api/api-error'
import type { OwnConversationsDeleted } from '@/adapters/api/conversations-client'
import { useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'

export interface ChatDeleteFeedback {
  failed: (error: unknown, scope: 'one' | 'all') => void
  deletedAll: (result: OwnConversationsDeleted) => void
}

export function useChatDeleteFeedback(): ChatDeleteFeedback {
  const t = useTranslations(researchCopy)
  return useMemo(() => {
    const reasonOf = (error: unknown): string => {
      if (error instanceof ApiRequestError) {
        if (error.reason === 'legal_hold') return t('deleteFeedback.legalHold')
        if (error.status === 502) return t('deleteFeedback.attachments')
        if (error.status === 429) return t('deleteFeedback.tooMany')
        return t('deleteFeedback.server', { status: error.status })
      }
      return t('deleteFeedback.offline')
    }
    return {
      failed: (error, scope) => {
        console.warn('[chat delete] failed:', error)
        toast.error(scope === 'one' ? t('deleteFeedback.oneFailed') : t('deleteFeedback.allFailed'), {
          description: reasonOf(error),
        })
      },
      deletedAll: ({ held }) => {
        if (held.length === 0) return
        toast.warning(t('deleteFeedback.held', { count: held.length }), {
          description: held
            .slice(0, 5)
            .map((chat) => chat.title?.trim() || t('sessionsPanel.untitledSession'))
            .join(', '),
        })
      },
    }
  }, [t])
}
