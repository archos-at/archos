'use client'

/**
 * Who reads this chat and what is kept from it, said under the composer where
 * the next message is written (ADR-0180: pilot offices held back because
 * nothing on screen said either).
 *
 * Two statements, each shown only while it is true and known:
 *
 * - **Temporary.** The conversation's `temporary`, as the store holds the
 *   server row's value. Shown to everyone in the thread, not only the owner
 *   who switched it.
 * - **Private.** The server's own answer about the thread, read where the chat
 *   already reads it (`useThreadSharing`, published by the shared-thread seam):
 *   `private` is "no grant and no blanket rule". `unknown` shows nothing, and
 *   so does an office without sharing, where the seam never asks.
 */

import type { JSX } from 'react'
import { Lock, MessageCircleDashed } from 'lucide-react'
import { FactLine } from '@/components/ui/fact-line'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { THREAD_COLUMN_INNER, THREAD_GUTTER } from '@/components/ui/thread-column'
import { useThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useConversationTemporary } from '../../lib/temporary-conversation'

export interface ConversationPrivacyLineViewProps {
  temporary: boolean
  /** Only the reader can open the conversation, and they can share it. */
  privateToReader: boolean
  className?: string
}

/** The statements alone, for the chat and for the preview. Nothing when neither holds. */
export function ConversationPrivacyLineView({
  temporary,
  privateToReader,
  className,
}: ConversationPrivacyLineViewProps): JSX.Element | null {
  const t = useTranslations(chatCopy)
  if (!temporary && !privateToReader) return null
  return (
    <div className={cn(THREAD_GUTTER, className)} data-testid="conversation-privacy-line">
      <div className={cn(THREAD_COLUMN_INNER, 'flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2')}>
        {temporary && (
          <FactLine icon={MessageCircleDashed} tone="default" role="status" testId="conversation-temporary-line">
            {t('temporary.statement')}
          </FactLine>
        )}
        {privateToReader && (
          <FactLine icon={Lock} testId="conversation-private-line">
            {t('privacy.onlyYou')}
          </FactLine>
        )}
      </div>
    </div>
  )
}

export interface ConversationPrivacyLineProps {
  conversationId: string | null | undefined
  /** Sharing is on for this office and this reader; without it nobody can be let in, and the seam is not asked. */
  canCollaborate: boolean
  className?: string
}

export function ConversationPrivacyLine({
  conversationId,
  canCollaborate,
  className,
}: ConversationPrivacyLineProps): JSX.Element | null {
  const temporary = useConversationTemporary(conversationId)
  const sharing = useThreadSharing(canCollaborate ? conversationId : null)
  return (
    <ConversationPrivacyLineView
      temporary={temporary}
      privateToReader={sharing === 'private'}
      className={className}
    />
  )
}
