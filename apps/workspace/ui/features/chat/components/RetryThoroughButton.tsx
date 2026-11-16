'use client'

import { useCallback, useEffect, useRef, type FC } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { capturePosthog } from '@/lib/analytics/posthog'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import { useAnswerFeedback } from '../hooks/use-answer-feedback'
import { useIsCurrentSessionBusy } from '../hooks/use-current-session-busy'
import { useChatStore } from '../store'
import { effectiveEffort, useEffortStore } from '../stores/effort-store'

export function thoroughEffortFor(original: ChatEffort): ChatEffort | null {
  if (original === 'xhigh') return null
  return original === 'high' ? 'xhigh' : 'high'
}

export interface RetryThoroughButtonProps {
  messageId: string
  conversationId?: string | null
}

export const RetryThoroughButton: FC<RetryThoroughButtonProps> = ({ messageId, conversationId }) => {
  const t = useTranslations(chatCopy)
  const projectId = useChatStore((s) => s.projectId)
  const { state } = useAnswerFeedback(messageId, conversationId, projectId)
  const send = useChatStore((s) => s.chatSendFn)
  const question = useChatStore((s) => {
    const messages = s.currentConversation?.messages ?? []
    const at = messages.findIndex((m) => m.id === messageId)
    if (at < 0) return null
    const asked = messages
      .slice(0, at)
      .findLast((m) => m.messageType === 'user' || m.role === 'user')
    return asked?.content?.trim() || null
  })
  const ranAt = useChatStore(
    (s) => s.currentConversation?.messages.find((m) => m.id === messageId)?.reasoningEffort
  )
  const dial = useEffortStore((s) => effectiveEffort(s, conversationId))
  const original = ranAt ?? dial
  const busy = useIsCurrentSessionBusy()

  const target = thoroughEffortFor(original)
  const visible = state?.verdict === 'down' && !!send && !!question && !!target

  const shownAtMount = useRef<boolean | null>(null)
  useEffect(() => {
    if (shownAtMount.current === null) shownAtMount.current = visible
  }, [visible])
  const arrives = shownAtMount.current === false

  const handleClick = useCallback(() => {
    if (!send || !question || !target) return
    capturePosthog('answer_retry_thorough', { message_id: messageId, original_effort: original })
    send(question, { reasoningEffort: target })
  }, [send, question, target, messageId, original])

  if (!visible) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={busy}
      aria-label={t('retryThorough.aria')}
      className={cn(
        'h-6 gap-1 px-1.5 text-xs font-normal pointer-coarse:h-11 pointer-coarse:px-3 text-muted-foreground hover:text-foreground',
        arrives && 'animate-in fade-in-0 duration-quick ease-entrance motion-reduce:animate-none'
      )}
    >
      <RotateCcw className="size-3" aria-hidden="true" />
      {t('retryThorough.action')}
    </Button>
  )
}
