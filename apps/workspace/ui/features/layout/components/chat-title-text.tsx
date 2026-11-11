'use client'

/**
 * The open chat's title in the thread header, with the temporary mark beside
 * it (ADR-0180 rule 2): a temporary chat looks like any other, and a person
 * scrolled up in one had only the line under the composer to tell them. The
 * glyph is the composer switch's; the word stands from `sm` up, where the
 * header has room, and the glyph alone on a phone. The mark says what the
 * server holds, never a switch still on its way (`temporary-switch-machine.ts`).
 */

import type { JSX } from 'react'
import { MessageCircleDashed } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'

export function ChatTitleText({ title, conversationId }: { title: string; conversationId: string | null | undefined }): JSX.Element {
  const t = useTranslations(chatCopy)
  // The store's copy is what the server holds (`temporary-conversation.ts`), never a switch on its way.
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
