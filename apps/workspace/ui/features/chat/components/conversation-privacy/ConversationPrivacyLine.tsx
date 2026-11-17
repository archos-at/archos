'use client'

import type { JSX } from 'react'
import { Lock, MessageCircleDashed } from 'lucide-react'
import { FactLine } from '@/components/ui/fact-line'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { THREAD_COLUMN_INNER, THREAD_GUTTER } from '@/components/ui/thread-column'
import { useThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useTemporarySwitch } from '../../lib/temporary-conversation'
import type { TemporarySwitchView } from '../../lib/temporary-switch-machine'

export type TemporaryStatement = TemporarySwitchView['statement']

export interface ConversationPrivacyLineViewProps {
  temporary: boolean | TemporaryStatement
  privateToReader: boolean
  className?: string
}

export function ConversationPrivacyLineView({
  temporary,
  privateToReader,
  className,
}: ConversationPrivacyLineViewProps): JSX.Element | null {
  const t = useTranslations(chatCopy)
  const statement = temporary === true ? 'temporary' : temporary || null
  if (!statement && !privateToReader) return null
  return (
    <div className={cn(THREAD_GUTTER, className)} data-testid="conversation-privacy-line">
      <div className={cn(THREAD_COLUMN_INNER, 'flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2')}>
        {statement && (
          <FactLine icon={MessageCircleDashed} tone="default" role="status" testId="conversation-temporary-line">
            {t(statement === 'temporary' ? 'temporary.statement' : `temporary.${statement}`)}
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
  canCollaborate: boolean
  className?: string
}

export function ConversationPrivacyLine({
  conversationId,
  canCollaborate,
  className,
}: ConversationPrivacyLineProps): JSX.Element | null {
  const temporary = useTemporarySwitch(conversationId).statement
  const sharing = useThreadSharing(canCollaborate ? conversationId : null)
  return (
    <ConversationPrivacyLineView
      temporary={temporary}
      privateToReader={sharing === 'private'}
      className={className}
    />
  )
}
