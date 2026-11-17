'use client'

import type { JSX } from 'react'
import { MessageCircleDashed } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'

export function ChatTitleText({ title, conversationId }: { title: string; conversationId: string | null | undefined }): JSX.Element {
  const t = useTranslations(chatCopy)
  const temporary = useChatStore(
    (state) => Boolean(conversationId) && state.currentConversation?.id === conversationId && state.currentConversation?.temporary === true
  )
  return (
    <>
      {/* `hyphens-auto` (the page is `lang="de"`): a German compound breaks at a syllable, never mid-word. */}
      <span className="line-clamp-2 hyphens-auto break-words sm:line-clamp-1">{title}</span>
      {temporary && (
        <Chip variant="muted" size="sm" className="ml-1.5 shrink-0" title={t('temporary.statement')} data-testid="chat-title-temporary">
          <MessageCircleDashed aria-hidden="true" />
          <span className="max-sm:sr-only">{t('temporary.label')}</span>
        </Chip>
      )}
    </>
  )
}
